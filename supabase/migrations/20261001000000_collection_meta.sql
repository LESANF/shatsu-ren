-- Shared-folder metadata so a second browser can tell same-named shared folders apart:
-- which device created it and when. Idempotent; safe to run in the SQL editor.

alter table shatsu.collections add column if not exists created_by_device uuid;

-- 서버 북마크 이름은 계정 안에서 겹치지 않는다 (앞뒤 공백·대소문자 무시)
create unique index if not exists collections_title_unique on shatsu.collections (workspace_id, lower(btrim(title)));

-- Backfill from the createCollection commit while it is still retained (30 days).
update shatsu.collections c
   set created_by_device = cm.source_device_id
  from shatsu.commits cm
 where c.created_by_device is null
   and cm.workspace_id = c.workspace_id
   and cm.kind = 'createCollection'
   and cm.payload -> 'collections' -> 0 ->> 'id' = c.id::text;

create or replace function shatsu.to_collection_json(c shatsu.collections) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'title', c.title, 'rootNodeId', c.root_node_id, 'revision', c.revision,
    'createdAt', c.created_at, 'createdByDeviceId', c.created_by_device)
$$;

create or replace function shatsu.op_create_collection(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_coll shatsu.collections; v_root shatsu.nodes; v_id uuid := (op->>'collectionId')::uuid; v_root_id uuid := (op->>'rootNodeId')::uuid;
begin
  if exists (select 1 from shatsu.collections where id = v_id) or exists (select 1 from shatsu.nodes where id = v_root_id) then
    perform shatsu.fail('DUPLICATE_ID', jsonb_build_object('nodeId', v_root_id));
  end if;
  if (select count(*) from shatsu.collections where workspace_id = c.workspace_id) >= 50 then perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('limit', 'maxCollections')); end if;
  if btrim(coalesce(op->>'title', '')) = '' then perform shatsu.fail('INVALID_OPERATION', '{"reason":"empty title"}'); end if;
  if exists (select 1 from shatsu.collections where workspace_id = c.workspace_id and lower(btrim(title)) = lower(btrim(op->>'title'))) then
    perform shatsu.fail('DUPLICATE_TITLE');
  end if;
  insert into shatsu.collections (id, workspace_id, title, root_node_id, created_by_device)
    values (v_id, c.workspace_id, btrim(op->>'title'), v_root_id, c.device_id) returning * into v_coll;
  insert into shatsu.nodes (id, workspace_id, collection_id, kind, parent_id, title) values (v_root_id, c.workspace_id, v_id, 'root', null, '') returning * into v_root;
  insert into shatsu.folder_orders (parent_id, workspace_id) values (v_root_id, c.workspace_id);
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('collections', jsonb_build_array(shatsu.to_collection_json(v_coll)),
      'nodes', jsonb_build_array(shatsu.to_node_json(v_root)),
      'orders', jsonb_build_array(jsonb_build_object('parentId', v_root_id, 'orderedChildIds', '[]'::jsonb, 'revision', 0))),
    'receipt', jsonb_build_object('nodeId', v_root_id));
end $$;

revoke all on function shatsu.to_collection_json(shatsu.collections) from public, anon, authenticated;
revoke all on function shatsu.op_create_collection(shatsu.ctx_t, jsonb) from public, anon, authenticated;

create or replace function shatsu.op_patch_collection(c shatsu.ctx_t, op jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare v_coll shatsu.collections;
begin
  select * into v_coll from shatsu.collections where id = (op->>'collectionId')::uuid and workspace_id = c.workspace_id for update;
  if v_coll.id is null then perform shatsu.fail('NOT_FOUND'); end if;
  if v_coll.revision <> (op->>'baseRevision')::int then perform shatsu.fail('REVISION_CONFLICT', jsonb_build_object('currentRevision', v_coll.revision)); end if;
  if btrim(coalesce(op->>'title', '')) = '' then perform shatsu.fail('INVALID_OPERATION', '{"reason":"empty title"}'); end if;
  if v_coll.title = btrim(op->>'title') then return jsonb_build_object('status', 'noop', 'receipt', jsonb_build_object('revision', v_coll.revision)); end if;
  if exists (select 1 from shatsu.collections where workspace_id = c.workspace_id and id <> v_coll.id and lower(btrim(title)) = lower(btrim(op->>'title'))) then
    perform shatsu.fail('DUPLICATE_TITLE');
  end if;
  update shatsu.collections set title = btrim(op->>'title'), revision = revision + 1 where id = v_coll.id returning * into v_coll;
  return jsonb_build_object('status', 'applied',
    'payload', jsonb_build_object('collections', jsonb_build_array(shatsu.to_collection_json(v_coll)), 'nodes', '[]'::jsonb, 'orders', '[]'::jsonb),
    'receipt', jsonb_build_object('revision', v_coll.revision));
end $$;
revoke all on function shatsu.op_patch_collection(shatsu.ctx_t, jsonb) from public, anon, authenticated;
