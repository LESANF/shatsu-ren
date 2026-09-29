-- shatsu-ren v1 core schema. 데이터는 shatsu 스키마(직접 접근 불가), 공개 RPC 는 public.sync_*.
-- 모든 SECURITY DEFINER 함수는 search_path='' + schema-qualified 참조를 쓴다.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists shatsu;
revoke all on schema shatsu from public;
revoke all on schema shatsu from anon, authenticated;
grant usage on schema shatsu to service_role;

-- ---------------------------------------------------------------- tables
create table shatsu.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null unique references auth.users (id) on delete cascade,
  protocol_version int not null default 1,
  generation_id uuid not null default gen_random_uuid(),
  head_seq bigint not null default 0,
  status text not null default 'active' check (status in ('active', 'deleting')),
  deletion_request_id uuid,
  created_at timestamptz not null default now()
);

create table shatsu.collections (
  id uuid primary key,
  workspace_id uuid not null references shatsu.workspaces (id) on delete cascade,
  title text not null,
  root_node_id uuid not null,
  revision int not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table shatsu.devices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references shatsu.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  auth_session_id uuid not null unique,
  label text not null default '',
  browser text not null default '',
  revoked_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index devices_workspace_idx on shatsu.devices (workspace_id);

create table shatsu.nodes (
  id uuid primary key,
  workspace_id uuid not null references shatsu.workspaces (id) on delete cascade,
  collection_id uuid not null,
  kind text not null check (kind in ('root', 'folder', 'bookmark')),
  parent_id uuid references shatsu.nodes (id),
  title text not null default '',
  url text,
  revision int not null default 1,
  deleted_at timestamptz,
  deletion_id uuid,
  constraint nodes_url_by_kind check ((kind = 'bookmark') = (url is not null)),
  constraint nodes_root_has_no_parent check ((kind = 'root') = (parent_id is null)),
  constraint nodes_collection_fk foreign key (workspace_id, collection_id)
    references shatsu.collections (workspace_id, id) on delete cascade
);
create index nodes_live_parent_idx on shatsu.nodes (workspace_id, parent_id) where deleted_at is null;
create index nodes_collection_idx on shatsu.nodes (collection_id);
create index nodes_deletion_idx on shatsu.nodes (deletion_id) where deletion_id is not null;

create table shatsu.folder_orders (
  parent_id uuid primary key references shatsu.nodes (id) on delete cascade,
  workspace_id uuid not null references shatsu.workspaces (id) on delete cascade,
  ordered_child_ids uuid[] not null default '{}',
  revision int not null default 0
);
create index folder_orders_workspace_idx on shatsu.folder_orders (workspace_id);

create table shatsu.commits (
  workspace_id uuid not null references shatsu.workspaces (id) on delete cascade,
  seq bigint not null,
  source_device_id uuid,
  op_id uuid not null,
  kind text not null,
  payload jsonb not null,
  server_time timestamptz not null default now(),
  primary key (workspace_id, seq)
);

create table shatsu.operation_receipts (
  workspace_id uuid not null references shatsu.workspaces (id) on delete cascade,
  op_id uuid not null,
  source_device_id uuid,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, op_id)
);

create table shatsu.trash_payloads (
  deletion_id uuid primary key,
  workspace_id uuid not null references shatsu.workspaces (id) on delete cascade,
  collection_id uuid not null,
  root_node_id uuid not null,
  root_title text,
  original_parent_id uuid not null,
  item_count int not null,
  payload jsonb,
  source_device_id uuid,
  deleted_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  restored_at timestamptz,
  purged_at timestamptz
);
create index trash_workspace_idx on shatsu.trash_payloads (workspace_id);

create table shatsu.rate_limits (
  device_id uuid not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (device_id, window_start)
);

-- 직접 접근 회수 (RLS 도 켜 두어 이중 방어)
alter table shatsu.workspaces enable row level security;
alter table shatsu.collections enable row level security;
alter table shatsu.devices enable row level security;
alter table shatsu.nodes enable row level security;
alter table shatsu.folder_orders enable row level security;
alter table shatsu.commits enable row level security;
alter table shatsu.operation_receipts enable row level security;
alter table shatsu.trash_payloads enable row level security;
alter table shatsu.rate_limits enable row level security;
revoke all on all tables in schema shatsu from anon, authenticated;

-- ---------------------------------------------------------------- limits & errors
create or replace function shatsu.limits() returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'maxActiveNodes', 10000, 'maxDepth', 32, 'maxTitleBytes', 4096, 'maxUrlBytes', 16384,
    'maxOperationBytes', 2097152, 'maxBatchOps', 100, 'maxResponseBytes', 33554432,
    'writesPerMinutePerDevice', 120, 'changesPageSize', 200, 'commitRetentionDays', 30, 'trashRetentionDays', 30)
$$;

-- 도메인 오류: SQLSTATE 'SR001', message=code, detail=jsonb
create or replace function shatsu.fail(p_code text, p_detail jsonb default '{}'::jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'SR001', message = p_code, detail = p_detail::text;
end $$;

create or replace function shatsu.err_to_json(p_msg text, p_detail text) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('ok', false, 'error',
    jsonb_build_object('code', p_msg) || coalesce(nullif(p_detail, '')::jsonb, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------- auth context
-- auth.sessions 조회는 이 좁은 함수에만 둔다.
create or replace function shatsu.session_valid(p_session uuid, p_user uuid) returns boolean
language sql security definer set search_path = '' as $$
  select exists (
    select 1 from auth.sessions s
    where s.id = p_session and s.user_id = p_user
      and (s.not_after is null or s.not_after > now())
  )
$$;
revoke all on function shatsu.session_valid(uuid, uuid) from public, anon, authenticated;

create or replace function shatsu.session_created_at(p_session uuid) returns timestamptz
language sql security definer set search_path = '' as $$
  select s.created_at from auth.sessions s where s.id = p_session
$$;
revoke all on function shatsu.session_created_at(uuid) from public, anon, authenticated;

create type shatsu.ctx_t as (user_id uuid, session_id uuid, workspace_id uuid, device_id uuid, generation_id uuid, status text);

-- p_bootstrap=true 는 sync_register_device 전용: 장치 행 존재를 요구하지 않는다.
create or replace function shatsu.ctx(p_bootstrap boolean default false) returns shatsu.ctx_t
language plpgsql security definer set search_path = '' as $$
declare
  c shatsu.ctx_t;
  d shatsu.devices;
begin
  c.user_id := auth.uid();
  if c.user_id is null then perform shatsu.fail('UNAUTHENTICATED'); end if;
  begin
    c.session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then c.session_id := null; end;
  if c.session_id is null or not shatsu.session_valid(c.session_id, c.user_id) then
    perform shatsu.fail('SESSION_INVALID');
  end if;
  select w.id, w.generation_id, w.status into c.workspace_id, c.generation_id, c.status
    from shatsu.workspaces w where w.owner_user_id = c.user_id;
  if c.workspace_id is not null and c.status = 'deleting' then perform shatsu.fail('WORKSPACE_DELETING'); end if;
  if p_bootstrap then return c; end if;
  if c.workspace_id is null then perform shatsu.fail('DEVICE_NOT_REGISTERED'); end if;
  select * into d from shatsu.devices where auth_session_id = c.session_id and workspace_id = c.workspace_id;
  if d.id is null then perform shatsu.fail('DEVICE_NOT_REGISTERED'); end if;
  if d.revoked_at is not null then perform shatsu.fail('DEVICE_REVOKED'); end if;
  c.device_id := d.id;
  -- lastSeenAt 은 15분 단위로만 갱신
  if d.last_seen_at is null or d.last_seen_at < now() - interval '15 minutes' then
    update shatsu.devices set last_seen_at = now() where id = d.id;
  end if;
  return c;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function shatsu.is_http_url(p text) returns boolean
language sql immutable set search_path = '' as $$
  select p is not null and (lower(left(p, 7)) = 'http://' or lower(left(p, 8)) = 'https://')
$$;

create or replace function shatsu.to_node_json(n shatsu.nodes) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'collectionId', n.collection_id, 'kind', n.kind, 'parentId', n.parent_id,
    'title', n.title, 'url', n.url, 'revision', n.revision,
    'deletedAt', n.deleted_at, 'deletionId', n.deletion_id)
$$;

create or replace function shatsu.to_order_json(o shatsu.folder_orders) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('parentId', o.parent_id, 'orderedChildIds', to_jsonb(o.ordered_child_ids), 'revision', o.revision)
$$;

create or replace function shatsu.to_collection_json(c shatsu.collections) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'rootNodeId', c.root_node_id, 'revision', c.revision)
$$;

-- 살아 있는 subtree id 집합 (root 포함)
create or replace function shatsu.live_subtree_ids(p_root uuid) returns setof uuid
language sql stable set search_path = '' as $$
  with recursive t as (
    select n.id from shatsu.nodes n where n.id = p_root and n.deleted_at is null
    union all
    select n.id from shatsu.nodes n join t on n.parent_id = t.id where n.deleted_at is null
  ) select id from t
$$;

-- protocol digest (packages/protocol/src/digest.ts 와 동일 규칙)
create or replace function shatsu.digest_input(p_nodes jsonb, p_orders jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce((
      select string_agg(format('N %s %s %s %s', x->>'id', x->>'revision', coalesce(x->>'parentId', '-'),
                        case when (x->>'deleted')::boolean then 1 else 0 end) || E'\n', '' order by (x->>'id') collate "C")
      from jsonb_array_elements(p_nodes) x), '')
    || coalesce((
      select string_agg(format('O %s %s %s', x->>'parentId', x->>'revision',
                        (select coalesce(string_agg(c #>> '{}', ','), '') from jsonb_array_elements(x->'orderedChildIds') c)) || E'\n', ''
                        order by (x->>'parentId') collate "C")
      from jsonb_array_elements(p_orders) x), '')
$$;

create or replace function shatsu.digest_hex(p_input text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_input, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function shatsu.subtree_digest(p_root uuid) returns text
language sql stable set search_path = '' as $$
  select shatsu.digest_hex(shatsu.digest_input(
    coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'revision', n.revision, 'parentId', n.parent_id, 'deleted', false))
      from shatsu.nodes n where n.id in (select shatsu.live_subtree_ids(p_root))), '[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('parentId', o.parent_id, 'revision', o.revision, 'orderedChildIds', to_jsonb(o.ordered_child_ids)))
      from shatsu.folder_orders o where o.parent_id in (select shatsu.live_subtree_ids(p_root))), '[]'::jsonb)))
$$;

create or replace function shatsu.node_depth(p_id uuid) returns int
language sql stable set search_path = '' as $$
  with recursive up as (
    select n.id, n.parent_id, 1 as d from shatsu.nodes n where n.id = p_id
    union all
    select n.id, n.parent_id, up.d + 1 from shatsu.nodes n join up on n.id = up.parent_id where up.d < 64
  ) select max(d) from up
$$;

create or replace function shatsu.is_descendant(p_node uuid, p_ancestor uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from shatsu.live_subtree_ids(p_ancestor) s where s = p_node)
$$;

create or replace function shatsu.active_count(p_ws uuid) returns int
language sql stable set search_path = '' as $$
  select count(*)::int from shatsu.nodes where workspace_id = p_ws and deleted_at is null and kind <> 'root'
$$;

create or replace function shatsu.arr_remove(a uuid[], x uuid) returns uuid[]
language sql immutable as $$ select coalesce(array_remove(a, x), '{}'::uuid[]) $$;

-- anchor 바로 뒤에 삽입 (null 이면 맨 앞)
create or replace function shatsu.arr_insert_after(a uuid[], x uuid, after_id uuid) returns uuid[]
language plpgsql immutable as $$
declare pos int; res uuid[];
begin
  res := shatsu.arr_remove(a, x);
  if after_id is null then return array[x] || res; end if;
  pos := array_position(res, after_id);
  if pos is null then return res || x; end if;
  return res[1:pos] || array[x] || res[pos+1:];
end $$;

create or replace function shatsu.bump_order(p_parent uuid, p_children uuid[]) returns shatsu.folder_orders
language plpgsql set search_path = '' as $$
declare o shatsu.folder_orders;
begin
  update shatsu.folder_orders set ordered_child_ids = p_children, revision = revision + 1
    where parent_id = p_parent returning * into o;
  return o;
end $$;

-- ---------------------------------------------------------------- op handlers (내부, 도메인 오류는 fail)
create or replace function shatsu.op_create(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_parent shatsu.nodes; v_node shatsu.nodes; v_order shatsu.folder_orders;
  v_id uuid := (op->>'nodeId')::uuid; v_kind text := op->>'nodeKind'; v_url text := op->>'url';
  v_title text := coalesce(op->>'title', ''); v_after uuid := (op->>'afterId')::uuid;
  v_coll uuid := (op->>'collectionId')::uuid; v_lim jsonb := shatsu.limits();
begin
  if v_kind not in ('folder', 'bookmark') then perform shatsu.fail('INVALID_OPERATION'); end if;
  select * into v_parent from shatsu.nodes where id = (op->>'parentId')::uuid and workspace_id = c.workspace_id;
  if v_parent.id is null or v_parent.deleted_at is not null or v_parent.kind = 'bookmark' or v_parent.collection_id <> v_coll then
    perform shatsu.fail('PARENT_NOT_FOUND', jsonb_build_object('parentId', op->>'parentId'));
  end if;
  if exists (select 1 from shatsu.nodes where id = v_id) then perform shatsu.fail('DUPLICATE_ID', jsonb_build_object('nodeId', v_id)); end if;
  if v_after is not null and not exists (select 1 from shatsu.nodes where id = v_after and parent_id = v_parent.id and deleted_at is null) then
    perform shatsu.fail('ANCHOR_NOT_FOUND', jsonb_build_object('parentId', v_parent.id));
  end if;
  if v_kind = 'bookmark' then
    if not shatsu.is_http_url(v_url) then perform shatsu.fail('INVALID_URL', jsonb_build_object('nodeId', v_id)); end if;
    if octet_length(v_url) > (v_lim->>'maxUrlBytes')::int then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('nodeId', v_id, 'limit', 'maxUrlBytes')); end if;
  else
    v_url := null;
  end if;
  if octet_length(v_title) > (v_lim->>'maxTitleBytes')::int then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('nodeId', v_id, 'limit', 'maxTitleBytes')); end if;
  if shatsu.node_depth(v_parent.id) >= (v_lim->>'maxDepth')::int then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('nodeId', v_id, 'limit', 'maxDepth')); end if;
  if shatsu.active_count(c.workspace_id) >= (v_lim->>'maxActiveNodes')::int then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('limit', 'maxActiveNodes')); end if;

  insert into shatsu.nodes (id, workspace_id, collection_id, kind, parent_id, title, url)
    values (v_id, c.workspace_id, v_coll, v_kind, v_parent.id, v_title, v_url) returning * into v_node;
  if v_kind = 'folder' then insert into shatsu.folder_orders (parent_id, workspace_id) values (v_id, c.workspace_id); end if;
  select * into v_order from shatsu.folder_orders where parent_id = v_parent.id for update;
  v_order := shatsu.bump_order(v_parent.id, shatsu.arr_insert_after(v_order.ordered_child_ids, v_id, v_after));
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('nodes', jsonb_build_array(shatsu.to_node_json(v_node)),
      'orders', jsonb_build_array(shatsu.to_order_json(v_order)) || case when v_kind = 'folder'
        then jsonb_build_array(jsonb_build_object('parentId', v_id, 'orderedChildIds', '[]'::jsonb, 'revision', 0)) else '[]'::jsonb end),
    'receipt', jsonb_build_object('nodeId', v_id, 'revision', v_node.revision, 'orderRevision', v_order.revision));
end $$;

create or replace function shatsu.op_patch(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_node shatsu.nodes; v_title text; v_url text; v_lim jsonb := shatsu.limits();
begin
  select * into v_node from shatsu.nodes where id = (op->>'nodeId')::uuid and workspace_id = c.workspace_id for update;
  if v_node.id is null or v_node.kind = 'root' or v_node.collection_id <> (op->>'collectionId')::uuid then perform shatsu.fail('NOT_FOUND', jsonb_build_object('nodeId', op->>'nodeId')); end if;
  if v_node.deleted_at is not null then perform shatsu.fail('ALREADY_DELETED', jsonb_build_object('nodeId', v_node.id, 'currentRevision', v_node.revision, 'deletionId', v_node.deletion_id)); end if;
  if v_node.revision <> (op->>'baseRevision')::int then perform shatsu.fail('REVISION_CONFLICT', jsonb_build_object('nodeId', v_node.id, 'currentRevision', v_node.revision)); end if;
  v_title := coalesce(op->'patch'->>'title', v_node.title);
  v_url := coalesce(op->'patch'->>'url', v_node.url);
  if v_node.kind = 'folder' and op->'patch' ? 'url' then perform shatsu.fail('INVALID_OPERATION', jsonb_build_object('nodeId', v_node.id)); end if;
  if v_node.kind = 'bookmark' and not shatsu.is_http_url(v_url) then perform shatsu.fail('INVALID_URL', jsonb_build_object('nodeId', v_node.id)); end if;
  if octet_length(v_title) > (v_lim->>'maxTitleBytes')::int or octet_length(coalesce(v_url, '')) > (v_lim->>'maxUrlBytes')::int then
    perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('nodeId', v_node.id));
  end if;
  if v_title = v_node.title and v_url is not distinct from v_node.url then
    return jsonb_build_object('status', 'noop', 'receipt', jsonb_build_object('nodeId', v_node.id, 'revision', v_node.revision));
  end if;
  update shatsu.nodes set title = v_title, url = v_url, revision = revision + 1 where id = v_node.id returning * into v_node;
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('nodes', jsonb_build_array(shatsu.to_node_json(v_node)), 'orders', '[]'::jsonb),
    'receipt', jsonb_build_object('nodeId', v_node.id, 'revision', v_node.revision));
end $$;

create or replace function shatsu.op_move(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_node shatsu.nodes; v_parent shatsu.nodes; v_old shatsu.folder_orders; v_new shatsu.folder_orders;
  v_after uuid := (op->>'afterId')::uuid; v_pos int; v_lim jsonb := shatsu.limits();
begin
  select * into v_node from shatsu.nodes where id = (op->>'nodeId')::uuid and workspace_id = c.workspace_id for update;
  if v_node.id is null or v_node.kind = 'root' or v_node.collection_id <> (op->>'collectionId')::uuid then perform shatsu.fail('NOT_FOUND', jsonb_build_object('nodeId', op->>'nodeId')); end if;
  if v_node.deleted_at is not null then perform shatsu.fail('ALREADY_DELETED', jsonb_build_object('nodeId', v_node.id, 'currentRevision', v_node.revision, 'deletionId', v_node.deletion_id)); end if;
  if v_node.revision <> (op->>'baseRevision')::int then perform shatsu.fail('REVISION_CONFLICT', jsonb_build_object('nodeId', v_node.id, 'currentRevision', v_node.revision)); end if;
  select * into v_parent from shatsu.nodes where id = (op->>'parentId')::uuid and workspace_id = c.workspace_id;
  if v_parent.id is null or v_parent.deleted_at is not null or v_parent.kind = 'bookmark' or v_parent.collection_id <> v_node.collection_id then
    perform shatsu.fail('PARENT_NOT_FOUND', jsonb_build_object('nodeId', v_node.id, 'parentId', op->>'parentId'));
  end if;
  if v_parent.id = v_node.id or shatsu.is_descendant(v_parent.id, v_node.id) then perform shatsu.fail('CYCLE', jsonb_build_object('nodeId', v_node.id)); end if;
  if v_after is not null and (v_after = v_node.id or not exists (select 1 from shatsu.nodes where id = v_after and parent_id = v_parent.id and deleted_at is null)) then
    perform shatsu.fail('ANCHOR_NOT_FOUND', jsonb_build_object('nodeId', v_node.id, 'parentId', v_parent.id));
  end if;
  if v_node.kind = 'folder' and shatsu.node_depth(v_parent.id) + (select coalesce(max(shatsu.node_depth(s)), 1) from shatsu.live_subtree_ids(v_node.id) s) - shatsu.node_depth(v_node.id) + 1 > (v_lim->>'maxDepth')::int then
    perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('nodeId', v_node.id, 'limit', 'maxDepth'));
  end if;
  select * into v_new from shatsu.folder_orders where parent_id = v_parent.id for update;
  if v_parent.id = v_node.parent_id then
    v_pos := array_position(v_new.ordered_child_ids, v_node.id);
    if (v_after is null and v_pos = 1) or (v_after is not null and v_pos = array_position(v_new.ordered_child_ids, v_after) + 1) then
      return jsonb_build_object('status', 'noop', 'receipt', jsonb_build_object('nodeId', v_node.id, 'revision', v_node.revision, 'orderRevision', v_new.revision));
    end if;
    v_new := shatsu.bump_order(v_parent.id, shatsu.arr_insert_after(v_new.ordered_child_ids, v_node.id, v_after));
    update shatsu.nodes set revision = revision + 1 where id = v_node.id returning * into v_node;
    return jsonb_build_object('status', 'applied',
      'payload', jsonb_build_object('nodes', jsonb_build_array(shatsu.to_node_json(v_node)), 'orders', jsonb_build_array(shatsu.to_order_json(v_new))),
      'receipt', jsonb_build_object('nodeId', v_node.id, 'revision', v_node.revision, 'orderRevision', v_new.revision));
  end if;
  select * into v_old from shatsu.folder_orders where parent_id = v_node.parent_id for update;
  v_old := shatsu.bump_order(v_node.parent_id, shatsu.arr_remove(v_old.ordered_child_ids, v_node.id));
  v_new := shatsu.bump_order(v_parent.id, shatsu.arr_insert_after(v_new.ordered_child_ids, v_node.id, v_after));
  update shatsu.nodes set parent_id = v_parent.id, revision = revision + 1 where id = v_node.id returning * into v_node;
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('nodes', jsonb_build_array(shatsu.to_node_json(v_node)),
      'orders', jsonb_build_array(shatsu.to_order_json(v_old), shatsu.to_order_json(v_new))),
    'receipt', jsonb_build_object('nodeId', v_node.id, 'revision', v_node.revision, 'orderRevision', v_new.revision));
end $$;

create or replace function shatsu.op_reorder(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_parent shatsu.nodes; v_order shatsu.folder_orders; v_ids uuid[];
begin
  select * into v_parent from shatsu.nodes where id = (op->>'parentId')::uuid and workspace_id = c.workspace_id;
  if v_parent.id is null or v_parent.deleted_at is not null or v_parent.kind = 'bookmark' or v_parent.collection_id <> (op->>'collectionId')::uuid then
    perform shatsu.fail('PARENT_NOT_FOUND', jsonb_build_object('parentId', op->>'parentId'));
  end if;
  select * into v_order from shatsu.folder_orders where parent_id = v_parent.id for update;
  if v_order.revision <> (op->>'baseOrderRevision')::int then perform shatsu.fail('ORDER_CONFLICT', jsonb_build_object('parentId', v_parent.id, 'currentOrderRevision', v_order.revision)); end if;
  select coalesce(array_agg((x #>> '{}')::uuid), '{}') into v_ids from jsonb_array_elements(op->'orderedChildIds') x;
  if (select count(distinct u) from unnest(v_ids) u) <> cardinality(v_ids)
     or (select array_agg(u order by u) from unnest(v_ids) u) is distinct from (select array_agg(u order by u) from unnest(v_order.ordered_child_ids) u) then
    perform shatsu.fail('INVALID_OPERATION', jsonb_build_object('parentId', v_parent.id, 'currentOrderRevision', v_order.revision, 'reason', 'child set mismatch'));
  end if;
  if v_ids = v_order.ordered_child_ids then
    return jsonb_build_object('status', 'noop', 'receipt', jsonb_build_object('parentId', v_parent.id, 'orderRevision', v_order.revision));
  end if;
  v_order := shatsu.bump_order(v_parent.id, v_ids);
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('nodes', '[]'::jsonb, 'orders', jsonb_build_array(shatsu.to_order_json(v_order))),
    'receipt', jsonb_build_object('parentId', v_parent.id, 'orderRevision', v_order.revision));
end $$;

create or replace function shatsu.op_delete(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  v_node shatsu.nodes; v_order shatsu.folder_orders; v_digest text; v_del uuid := gen_random_uuid();
  v_ids uuid[]; v_nodes jsonb; v_orders jsonb; v_count int;
begin
  select * into v_node from shatsu.nodes where id = (op->>'nodeId')::uuid and workspace_id = c.workspace_id for update;
  if v_node.id is null or v_node.kind = 'root' or v_node.collection_id <> (op->>'collectionId')::uuid then perform shatsu.fail('NOT_FOUND', jsonb_build_object('nodeId', op->>'nodeId')); end if;
  if v_node.deleted_at is not null then perform shatsu.fail('ALREADY_DELETED', jsonb_build_object('nodeId', v_node.id, 'currentRevision', v_node.revision, 'deletionId', v_node.deletion_id)); end if;
  if v_node.revision <> (op->>'baseRevision')::int then perform shatsu.fail('REVISION_CONFLICT', jsonb_build_object('nodeId', v_node.id, 'currentRevision', v_node.revision)); end if;
  -- subtree 잠금 후 digest 비교 (동시 추가·수정·이동 검출)
  perform 1 from shatsu.nodes where id in (select shatsu.live_subtree_ids(v_node.id)) for update;
  v_digest := shatsu.subtree_digest(v_node.id);
  if v_digest <> (op->>'expectedSubtreeDigest') then
    perform shatsu.fail('DIGEST_MISMATCH', jsonb_build_object('nodeId', v_node.id, 'currentRevision', v_node.revision));
  end if;
  select array_agg(s) into v_ids from shatsu.live_subtree_ids(v_node.id) s;
  v_count := cardinality(v_ids);
  -- 휴지통 본문 (복원용)
  select jsonb_agg(shatsu.to_node_json(n)) into v_nodes from shatsu.nodes n where n.id = any(v_ids);
  select coalesce(jsonb_agg(shatsu.to_order_json(o)), '[]'::jsonb) into v_orders from shatsu.folder_orders o where o.parent_id = any(v_ids);
  insert into shatsu.trash_payloads (deletion_id, workspace_id, collection_id, root_node_id, root_title, original_parent_id, item_count, payload, source_device_id)
    values (v_del, c.workspace_id, v_node.collection_id, v_node.id, v_node.title, v_node.parent_id, v_count,
      jsonb_build_object('nodes', v_nodes, 'orders', v_orders), c.device_id);
  update shatsu.nodes set deleted_at = now(), deletion_id = v_del, revision = revision + 1 where id = any(v_ids);
  select * into v_order from shatsu.folder_orders where parent_id = v_node.parent_id for update;
  v_order := shatsu.bump_order(v_node.parent_id, shatsu.arr_remove(v_order.ordered_child_ids, v_node.id));
  select jsonb_agg(shatsu.to_node_json(n)) into v_nodes from shatsu.nodes n where n.id = any(v_ids);
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('nodes', v_nodes, 'orders', jsonb_build_array(shatsu.to_order_json(v_order)), 'deletionId', v_del),
    'receipt', jsonb_build_object('nodeId', v_node.id, 'deletionId', v_del, 'orderRevision', v_order.revision));
end $$;

create or replace function shatsu.op_restore(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  t shatsu.trash_payloads; v_parent shatsu.nodes; v_target uuid; v_ids uuid[]; v_order shatsu.folder_orders;
  v_nodes jsonb; v_orders jsonb; x jsonb; v_lim jsonb := shatsu.limits();
begin
  select * into t from shatsu.trash_payloads where deletion_id = (op->>'deletionId')::uuid and workspace_id = c.workspace_id for update;
  if t.deletion_id is null or t.restored_at is not null or t.purged_at is not null or t.expires_at < now() or t.payload is null
     or t.collection_id <> (op->>'collectionId')::uuid then
    perform shatsu.fail('NOT_FOUND', jsonb_build_object('deletionId', op->>'deletionId'));
  end if;
  v_target := coalesce((op->>'parentId')::uuid, t.original_parent_id);
  select * into v_parent from shatsu.nodes where id = v_target and workspace_id = c.workspace_id;
  if v_parent.id is null or v_parent.deleted_at is not null or v_parent.kind = 'bookmark' or v_parent.collection_id <> t.collection_id then
    perform shatsu.fail('PARENT_NOT_FOUND', jsonb_build_object('deletionId', t.deletion_id, 'parentId', v_target));
  end if;
  select array_agg(id) into v_ids from shatsu.nodes where deletion_id = t.deletion_id and deleted_at is not null;
  if v_ids is null or cardinality(v_ids) <> t.item_count then
    perform shatsu.fail('RESTORE_CONFLICT', jsonb_build_object('deletionId', t.deletion_id));
  end if;
  if shatsu.active_count(c.workspace_id) + t.item_count > (v_lim->>'maxActiveNodes')::int then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('limit', 'maxActiveNodes')); end if;
  update shatsu.nodes set deleted_at = null, deletion_id = null, revision = revision + 1 where id = any(v_ids);
  update shatsu.nodes set parent_id = v_parent.id, revision = revision + 1 where id = t.root_node_id;
  -- 내부 순서 복원
  for x in select * from jsonb_array_elements(t.payload->'orders') loop
    update shatsu.folder_orders set revision = revision + 1,
      ordered_child_ids = (select coalesce(array_agg((e #>> '{}')::uuid), '{}') from jsonb_array_elements(x->'orderedChildIds') e)
      where parent_id = (x->>'parentId')::uuid;
  end loop;
  select * into v_order from shatsu.folder_orders where parent_id = v_parent.id for update;
  v_order := shatsu.bump_order(v_parent.id, shatsu.arr_remove(v_order.ordered_child_ids, t.root_node_id) || t.root_node_id);
  update shatsu.trash_payloads set restored_at = now() where deletion_id = t.deletion_id;
  select jsonb_agg(shatsu.to_node_json(n)) into v_nodes from shatsu.nodes n where n.id = any(v_ids);
  select coalesce(jsonb_agg(shatsu.to_order_json(o)), '[]'::jsonb) into v_orders from shatsu.folder_orders o where o.parent_id = any(v_ids) or o.parent_id = v_parent.id;
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('nodes', v_nodes, 'orders', v_orders, 'restoredDeletionId', t.deletion_id),
    'receipt', jsonb_build_object('nodeId', t.root_node_id, 'deletionId', t.deletion_id, 'parentId', v_parent.id));
end $$;

create or replace function shatsu.op_create_collection(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_coll shatsu.collections; v_root shatsu.nodes; v_id uuid := (op->>'collectionId')::uuid; v_root_id uuid := (op->>'rootNodeId')::uuid;
begin
  if exists (select 1 from shatsu.collections where id = v_id) or exists (select 1 from shatsu.nodes where id = v_root_id) then
    perform shatsu.fail('DUPLICATE_ID', jsonb_build_object('nodeId', v_root_id));
  end if;
  if (select count(*) from shatsu.collections where workspace_id = c.workspace_id) >= 50 then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('limit', 'maxCollections')); end if;
  insert into shatsu.collections (id, workspace_id, title, root_node_id) values (v_id, c.workspace_id, coalesce(op->>'title', ''), v_root_id) returning * into v_coll;
  insert into shatsu.nodes (id, workspace_id, collection_id, kind, parent_id, title) values (v_root_id, c.workspace_id, v_id, 'root', null, '') returning * into v_root;
  insert into shatsu.folder_orders (parent_id, workspace_id) values (v_root_id, c.workspace_id);
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('collections', jsonb_build_array(shatsu.to_collection_json(v_coll)),
      'nodes', jsonb_build_array(shatsu.to_node_json(v_root)),
      'orders', jsonb_build_array(jsonb_build_object('parentId', v_root_id, 'orderedChildIds', '[]'::jsonb, 'revision', 0))),
    'receipt', jsonb_build_object('nodeId', v_root_id));
end $$;

create or replace function shatsu.op_patch_collection(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_coll shatsu.collections;
begin
  select * into v_coll from shatsu.collections where id = (op->>'collectionId')::uuid and workspace_id = c.workspace_id for update;
  if v_coll.id is null then perform shatsu.fail('NOT_FOUND'); end if;
  if v_coll.revision <> (op->>'baseRevision')::int then perform shatsu.fail('REVISION_CONFLICT', jsonb_build_object('currentRevision', v_coll.revision)); end if;
  if v_coll.title = coalesce(op->>'title', '') then return jsonb_build_object('status', 'noop', 'receipt', jsonb_build_object('revision', v_coll.revision)); end if;
  update shatsu.collections set title = coalesce(op->>'title', ''), revision = revision + 1 where id = v_coll.id returning * into v_coll;
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('collections', jsonb_build_array(shatsu.to_collection_json(v_coll)), 'nodes', '[]'::jsonb, 'orders', '[]'::jsonb),
    'receipt', jsonb_build_object('revision', v_coll.revision));
end $$;

-- ---------------------------------------------------------------- apply one (receipt/commit/seq)
-- 호출자는 workspace 행을 FOR UPDATE 로 잠근 상태여야 한다.
create or replace function shatsu.apply_one(c shatsu.ctx_t, p_env jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  op jsonb := p_env->'op'; v_op_id uuid; v_hash text; v_existing shatsu.operation_receipts; v_kind text;
  r jsonb; v_receipt jsonb; v_seq bigint; v_code text; v_detail text; v_lim jsonb := shatsu.limits();
begin
  if (p_env->>'protocolVersion') is distinct from '1' then
    return jsonb_build_object('opId', op->>'opId', 'status', 'rejected', 'code', 'PROTOCOL_VERSION_MISMATCH');
  end if;
  if (p_env->>'generationId') is distinct from c.generation_id::text then
    return jsonb_build_object('opId', op->>'opId', 'status', 'rejected', 'code', 'SERVER_GENERATION_CHANGED', 'generationId', c.generation_id);
  end if;
  begin
    v_op_id := (op->>'opId')::uuid;
  exception when others then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_OPERATION');
  end;
  if octet_length(op::text) > (v_lim->>'maxOperationBytes')::int then
    return jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'code', 'LIMIT_EXCEEDED');
  end if;
  v_hash := shatsu.digest_hex(op::text);
  select * into v_existing from shatsu.operation_receipts where workspace_id = c.workspace_id and op_id = v_op_id;
  if v_existing.op_id is not null then
    if v_existing.request_hash = v_hash then return v_existing.result; end if;
    return jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'code', 'OP_ID_REUSED');
  end if;
  v_kind := op->>'kind';
  begin
    r := case v_kind
      when 'create' then shatsu.op_create(c, op)
      when 'patch' then shatsu.op_patch(c, op)
      when 'move' then shatsu.op_move(c, op)
      when 'reorder' then shatsu.op_reorder(c, op)
      when 'deleteSubtree' then shatsu.op_delete(c, op)
      when 'restore' then shatsu.op_restore(c, op)
      when 'createCollection' then shatsu.op_create_collection(c, op)
      when 'patchCollection' then shatsu.op_patch_collection(c, op)
      else null end;
    if r is null then perform shatsu.fail('INVALID_OPERATION', jsonb_build_object('reason', 'unknown kind')); end if;
  exception
    when sqlstate 'SR001' then
      get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
      v_receipt := jsonb_build_object('opId', v_op_id, 'status',
          case when v_code in ('REVISION_CONFLICT', 'ORDER_CONFLICT', 'DIGEST_MISMATCH', 'ALREADY_DELETED', 'RESTORE_CONFLICT', 'ANCHOR_NOT_FOUND', 'PARENT_NOT_FOUND')
               then 'conflict' else 'rejected' end,
          'code', v_code) || coalesce(nullif(v_detail, '')::jsonb, '{}'::jsonb);
      -- 한도·일시 오류는 영구 receipt 를 만들지 않는다
      if v_code not in ('LIMIT_EXCEEDED', 'RATE_LIMITED') then
        insert into shatsu.operation_receipts (workspace_id, op_id, source_device_id, request_hash, result)
          values (c.workspace_id, v_op_id, c.device_id, v_hash, v_receipt);
      end if;
      return v_receipt;
    when invalid_text_representation or datatype_mismatch or null_value_not_allowed then
      v_receipt := jsonb_build_object('opId', v_op_id, 'status', 'rejected', 'code', 'INVALID_OPERATION');
      insert into shatsu.operation_receipts (workspace_id, op_id, source_device_id, request_hash, result)
        values (c.workspace_id, v_op_id, c.device_id, v_hash, v_receipt);
      return v_receipt;
  end;
  if r->>'status' = 'noop' then
    v_receipt := jsonb_build_object('opId', v_op_id, 'status', 'noop') || (r->'receipt');
  else
    update shatsu.workspaces set head_seq = head_seq + 1 where id = c.workspace_id returning head_seq into v_seq;
    insert into shatsu.commits (workspace_id, seq, source_device_id, op_id, kind, payload)
      values (c.workspace_id, v_seq, c.device_id, v_op_id, v_kind, r->'payload');
    v_receipt := jsonb_build_object('opId', v_op_id, 'status', 'applied', 'seq', v_seq) || (r->'receipt');
  end if;
  insert into shatsu.operation_receipts (workspace_id, op_id, source_device_id, request_hash, result)
    values (c.workspace_id, v_op_id, c.device_id, v_hash, v_receipt);
  return v_receipt;
end $$;

create or replace function shatsu.rate_limit_check(p_device uuid) returns void
language plpgsql set search_path = '' as $$
declare v_count int; v_win timestamptz := date_trunc('minute', now());
begin
  insert into shatsu.rate_limits (device_id, window_start, count) values (p_device, v_win, 1)
    on conflict (device_id, window_start) do update set count = shatsu.rate_limits.count + 1 returning count into v_count;
  delete from shatsu.rate_limits where device_id = p_device and window_start < v_win - interval '2 minutes';
  if v_count > (shatsu.limits()->>'writesPerMinutePerDevice')::int then
    perform shatsu.fail('RATE_LIMITED', jsonb_build_object('retryAfterSeconds', 60 - extract(second from now())::int));
  end if;
end $$;

create or replace function shatsu.notify_changed(p_ws uuid) returns void
language plpgsql set search_path = '' as $$
begin
  -- 고정 payload 만. 본문·seq·개수는 넣지 않는다. 실패는 진단으로만 남긴다.
  perform realtime.send(jsonb_build_object('type', 'changed'), 'changed', 'workspace:' || p_ws::text, true);
exception when others then
  raise warning 'shatsu.notify_changed failed: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------- public RPC
create or replace function public.sync_register_device(p_label text default '', p_browser text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; d shatsu.devices; w shatsu.workspaces; v_code text; v_detail text;
begin
  c := shatsu.ctx(true);
  if c.workspace_id is null then
    insert into shatsu.workspaces (owner_user_id) values (c.user_id) on conflict (owner_user_id) do nothing;
    select * into w from shatsu.workspaces where owner_user_id = c.user_id;
    c.workspace_id := w.id; c.generation_id := w.generation_id;
  end if;
  select * into d from shatsu.devices where auth_session_id = c.session_id for update;
  if d.id is not null then
    if d.workspace_id <> c.workspace_id or d.user_id <> c.user_id then perform shatsu.fail('FORBIDDEN'); end if;
    if d.revoked_at is not null then perform shatsu.fail('DEVICE_REVOKED'); end if;
    update shatsu.devices set label = coalesce(nullif(left(p_label, 80), ''), label), browser = coalesce(nullif(left(p_browser, 80), ''), browser), last_seen_at = now() where id = d.id returning * into d;
  else
    if (select count(*) from shatsu.devices where workspace_id = c.workspace_id and revoked_at is null) >= 20 then perform shatsu.fail('LIMIT_EXCEEDED', '{"limit":"maxDevices"}'); end if;
    insert into shatsu.devices (workspace_id, user_id, auth_session_id, label, browser, last_seen_at)
      values (c.workspace_id, c.user_id, c.session_id, left(coalesce(p_label, ''), 80), left(coalesce(p_browser, ''), 80), now()) returning * into d;
  end if;
  select * into w from shatsu.workspaces where id = c.workspace_id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('deviceId', d.id, 'workspaceId', w.id, 'generationId', w.generation_id,
    'protocolVersion', w.protocol_version, 'headSeq', w.head_seq));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

create or replace function public.sync_info() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; w shatsu.workspaces; v_code text; v_detail text;
begin
  c := shatsu.ctx();
  select * into w from shatsu.workspaces where id = c.workspace_id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('protocolVersion', w.protocol_version, 'generationId', w.generation_id,
    'workspaceId', w.id, 'headSeq', w.head_seq, 'status', w.status, 'limits', shatsu.limits()));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

create or replace function public.sync_devices() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; v_code text; v_detail text;
begin
  c := shatsu.ctx();
  return jsonb_build_object('ok', true, 'data', coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'browser', d.browser, 'createdAt', d.created_at,
      'lastSeenAt', d.last_seen_at, 'revokedAt', d.revoked_at, 'isCurrent', d.id = c.device_id) order by d.created_at)
    from shatsu.devices d where d.workspace_id = c.workspace_id), '[]'::jsonb));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

create or replace function public.sync_revoke_device(p_device_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; v_code text; v_detail text; n int;
begin
  c := shatsu.ctx();
  update shatsu.devices set revoked_at = coalesce(revoked_at, now()) where id = p_device_id and workspace_id = c.workspace_id;
  get diagnostics n = row_count;
  if n = 0 then perform shatsu.fail('NOT_FOUND'); end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('deviceId', p_device_id));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

-- snapshot: 단일 SELECT 로 nodes/orders/headSeq 를 같은 MVCC snapshot 에서 읽는다.
create or replace function public.sync_snapshot() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; v_code text; v_detail text; res jsonb;
begin
  c := shatsu.ctx();
  select jsonb_build_object(
    'generationId', w.generation_id, 'headSeq', w.head_seq,
    'collections', coalesce((select jsonb_agg(shatsu.to_collection_json(x) order by x.created_at) from shatsu.collections x where x.workspace_id = w.id), '[]'::jsonb),
    'nodes', coalesce((select jsonb_agg(shatsu.to_node_json(n)) from shatsu.nodes n where n.workspace_id = w.id and n.deleted_at is null), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(shatsu.to_order_json(o)) from shatsu.folder_orders o join shatsu.nodes n on n.id = o.parent_id where o.workspace_id = w.id and n.deleted_at is null), '[]'::jsonb))
  into res from shatsu.workspaces w where w.id = c.workspace_id;
  if octet_length(res::text) > (shatsu.limits()->>'maxResponseBytes')::int then perform shatsu.fail('LIMIT_EXCEEDED', '{"limit":"maxResponseBytes"}'); end if;
  return jsonb_build_object('ok', true, 'data', res);
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

create or replace function public.sync_changes(p_after_seq bigint, p_limit int default 200) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c shatsu.ctx_t; v_code text; v_detail text; w shatsu.workspaces; v_min bigint; v_lim int; rec record;
  v_commits jsonb := '[]'::jsonb; v_bytes bigint := 0; v_next bigint; v_more boolean := false; v_max_bytes int := (shatsu.limits()->>'maxResponseBytes')::int;
begin
  c := shatsu.ctx();
  select * into w from shatsu.workspaces where id = c.workspace_id;
  v_lim := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_next := coalesce(p_after_seq, 0);
  if v_next > w.head_seq then perform shatsu.fail('CURSOR_EXPIRED', jsonb_build_object('headSeq', w.head_seq)); end if;
  select min(seq) into v_min from shatsu.commits where workspace_id = w.id;
  -- 보관 범위 밖 cursor: 0 (빈 workspace) 은 허용
  if v_next < coalesce(v_min, w.head_seq + 1) - 1 and not (v_next = 0 and w.head_seq = 0) then
    perform shatsu.fail('CURSOR_EXPIRED', jsonb_build_object('headSeq', w.head_seq));
  end if;
  for rec in select seq, source_device_id, op_id, kind, payload, server_time from shatsu.commits
             where workspace_id = w.id and seq > v_next order by seq limit v_lim + 1 loop
    if jsonb_array_length(v_commits) >= v_lim then v_more := true; exit; end if;
    v_bytes := v_bytes + octet_length(rec.payload::text);
    if v_bytes > v_max_bytes then
      if jsonb_array_length(v_commits) = 0 then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('limit', 'maxResponseBytes', 'seq', rec.seq)); end if;
      v_more := true; exit;
    end if;
    v_commits := v_commits || jsonb_build_object('seq', rec.seq, 'sourceDeviceId', rec.source_device_id, 'opId', rec.op_id,
      'kind', rec.kind, 'payload', rec.payload, 'serverTime', rec.server_time);
    v_next := rec.seq;
  end loop;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('generationId', w.generation_id, 'headSeq', w.head_seq,
    'commits', v_commits, 'nextCursor', v_next, 'hasMore', v_more));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

create or replace function public.sync_apply_operation(p_env jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; v_code text; v_detail text; r jsonb; w shatsu.workspaces;
begin
  c := shatsu.ctx();
  select * into w from shatsu.workspaces where id = c.workspace_id for update;  -- 보관함 직렬화
  perform shatsu.rate_limit_check(c.device_id);
  r := shatsu.apply_one(c, p_env);
  if r->>'status' = 'applied' then perform shatsu.notify_changed(c.workspace_id); end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('receipt', r, 'headSeq', (select head_seq from shatsu.workspaces where id = c.workspace_id), 'generationId', c.generation_id));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

-- 묶음: 입력 순서 적용, 도메인 충돌을 만나면 그 receipt 까지 기록하고 뒤는 not_attempted. 예기치 않은 예외는 전체 rollback.
create or replace function public.sync_apply_operations(p_envs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c shatsu.ctx_t; v_code text; v_detail text; w shatsu.workspaces; e jsonb; r jsonb; v_receipts jsonb := '[]'::jsonb;
  v_stop boolean := false; v_applied boolean := false; v_lim jsonb := shatsu.limits();
begin
  c := shatsu.ctx();
  if jsonb_typeof(p_envs) <> 'array' then perform shatsu.fail('INVALID_OPERATION'); end if;
  if jsonb_array_length(p_envs) > (v_lim->>'maxBatchOps')::int or octet_length(p_envs::text) > (v_lim->>'maxOperationBytes')::int then
    perform shatsu.fail('LIMIT_EXCEEDED', '{"limit":"maxBatchOps"}');
  end if;
  select * into w from shatsu.workspaces where id = c.workspace_id for update;
  perform shatsu.rate_limit_check(c.device_id);
  for e in select * from jsonb_array_elements(p_envs) loop
    if v_stop then
      v_receipts := v_receipts || jsonb_build_object('opId', e->'op'->>'opId', 'status', 'not_attempted', 'code', 'NOT_ATTEMPTED');
      continue;
    end if;
    r := shatsu.apply_one(c, e);
    v_receipts := v_receipts || r;
    if r->>'status' = 'applied' then v_applied := true; end if;
    if r->>'status' in ('conflict', 'rejected') then v_stop := true; end if;
  end loop;
  if v_applied then perform shatsu.notify_changed(c.workspace_id); end if;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('receipts', v_receipts, 'headSeq', (select head_seq from shatsu.workspaces where id = c.workspace_id), 'generationId', c.generation_id));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

create or replace function public.sync_trash() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; v_code text; v_detail text;
begin
  c := shatsu.ctx();
  return jsonb_build_object('ok', true, 'data', coalesce((
    select jsonb_agg(jsonb_build_object('deletionId', t.deletion_id, 'collectionId', t.collection_id, 'rootNodeId', t.root_node_id,
      'rootTitle', t.root_title, 'itemCount', t.item_count, 'originalParentId', t.original_parent_id, 'deletedAt', t.deleted_at,
      'expiresAt', t.expires_at, 'restoredAt', t.restored_at, 'sourceDeviceId', t.source_device_id) order by t.deleted_at desc)
    from shatsu.trash_payloads t where t.workspace_id = c.workspace_id and t.purged_at is null and t.expires_at > now()), '[]'::jsonb));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

-- Realtime private channel 구독 권한 (정책 내부에서 호출; shatsu 스키마 접근은 이 함수만)
create or replace function public.shatsu_can_subscribe(p_topic text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (
    select 1 from shatsu.workspaces w
    join shatsu.devices d on d.workspace_id = w.id
    where w.owner_user_id = auth.uid() and w.status = 'active'
      and p_topic = 'workspace:' || w.id::text
      and d.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and d.revoked_at is null
  )
$$;

create policy "shatsu workspace owner receives broadcast" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.shatsu_can_subscribe(realtime.topic()));
-- client 발행(insert) 정책은 없음 → 거부

-- ---------------------------------------------------------------- 계정 삭제 (Edge Function 이 service_role 로 호출)
create or replace function public.account_deletion_begin(p_user_id uuid, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare w shatsu.workspaces;
begin
  select * into w from shatsu.workspaces where owner_user_id = p_user_id for update;
  if w.id is null then return jsonb_build_object('ok', true, 'data', jsonb_build_object('workspaceId', null, 'status', 'none')); end if;
  if w.status = 'deleting' and w.deletion_request_id <> p_request_id then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object('code', 'WORKSPACE_DELETING'));
  end if;
  update shatsu.workspaces set status = 'deleting', deletion_request_id = p_request_id where id = w.id;
  update shatsu.devices set revoked_at = coalesce(revoked_at, now()) where workspace_id = w.id;
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('workspaceId', w.id, 'status', 'deleting'));
end $$;

create or replace function public.account_session_created_at(p_session_id uuid) returns timestamptz
language sql security definer set search_path = '' as $$ select shatsu.session_created_at(p_session_id) $$;

-- ---------------------------------------------------------------- 만료 정리 (운영 SQL 작업; 로컬에서 수동 호출 가능)
create or replace function shatsu.purge_expired() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n_commits int; n_trash int;
begin
  delete from shatsu.commits where server_time < now() - ((shatsu.limits()->>'commitRetentionDays')::int || ' days')::interval;
  get diagnostics n_commits = row_count;
  -- 휴지통 본문·복구용 개인정보 제거, ID·삭제 상태·revision 은 보존
  update shatsu.nodes n set title = '', url = case when kind = 'bookmark' then 'https://purged.invalid/' else null end
    from shatsu.trash_payloads t where n.deletion_id = t.deletion_id and t.purged_at is null and t.expires_at < now() and t.restored_at is null;
  update shatsu.trash_payloads set payload = null, root_title = null, purged_at = now() where purged_at is null and expires_at < now();
  get diagnostics n_trash = row_count;
  delete from shatsu.rate_limits where window_start < now() - interval '10 minutes';
  return jsonb_build_object('commitsDeleted', n_commits, 'trashPurged', n_trash);
end $$;

-- DB 복원 후 운영 절차: 모든 generation 갱신 + 모든 장치 재인증
create or replace function shatsu.rotate_generations() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update shatsu.workspaces set generation_id = gen_random_uuid();
  get diagnostics n = row_count;
  update shatsu.devices set revoked_at = coalesce(revoked_at, now());
  return n;
end $$;

-- ---------------------------------------------------------------- grants
revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function public.sync_register_device(text, text) to authenticated;
grant execute on function public.sync_info() to authenticated;
grant execute on function public.sync_devices() to authenticated;
grant execute on function public.sync_revoke_device(uuid) to authenticated;
grant execute on function public.sync_snapshot() to authenticated;
grant execute on function public.sync_changes(bigint, int) to authenticated;
grant execute on function public.sync_apply_operation(jsonb) to authenticated;
grant execute on function public.sync_apply_operations(jsonb) to authenticated;
grant execute on function public.sync_trash() to authenticated;
grant execute on function public.shatsu_can_subscribe(text) to authenticated;
grant execute on function public.account_deletion_begin(uuid, uuid) to service_role;
grant execute on function public.account_session_created_at(uuid) to service_role;
-- 내부 함수는 authenticated 에게 EXECUTE 없음
revoke all on all functions in schema shatsu from public, anon, authenticated;
grant execute on function shatsu.purge_expired() to service_role;
grant execute on function shatsu.rotate_generations() to service_role;

-- pg_cron 이 있으면 매일 정리
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('shatsu-purge-expired', '17 3 * * *', $c$ select shatsu.purge_expired() $c$);
  end if;
end $$;
