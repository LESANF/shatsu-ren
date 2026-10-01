-- Function-only upgrade: reject malformed mutation requests, enforce depth, and require live sessions.

create or replace function shatsu.validate_operation(op jsonb) returns void
language plpgsql set search_path = '' as $$
declare
  v_required text[]; v_field text; v_value jsonb;
  v_uuid_pattern text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  v_required := case op->>'kind'
    when 'create' then array['nodeId', 'nodeKind', 'parentId', 'title', 'url', 'afterId']
    when 'patch' then array['nodeId', 'baseRevision', 'patch']
    when 'move' then array['nodeId', 'baseRevision', 'parentId', 'afterId']
    when 'reorder' then array['parentId', 'baseOrderRevision', 'orderedChildIds']
    when 'deleteSubtree' then array['nodeId', 'baseRevision', 'expectedSubtreeDigest']
    when 'restore' then array['deletionId', 'parentId']
    when 'createCollection' then array['rootNodeId', 'title']
    when 'patchCollection' then array['baseRevision', 'title']
    else null end;
  if v_required is null or not (op ?& (array['opId', 'collectionId'] || v_required)) then
    perform shatsu.fail('INVALID_OPERATION');
  end if;
  foreach v_field in array array['opId', 'collectionId'] || v_required loop
    v_value := op->v_field;
    if v_field in ('opId', 'collectionId', 'nodeId', 'rootNodeId', 'deletionId', 'parentId', 'afterId') then
      if v_value = 'null'::jsonb and (v_field = 'afterId' or (v_field = 'parentId' and op->>'kind' = 'restore')) then continue; end if;
      if jsonb_typeof(v_value) is distinct from 'string' or (op->>v_field) !~ v_uuid_pattern then perform shatsu.fail('INVALID_OPERATION'); end if;
    elsif v_field in ('baseRevision', 'baseOrderRevision') then
      if jsonb_typeof(v_value) is distinct from 'number' then perform shatsu.fail('INVALID_OPERATION'); end if;
      if (v_value::text)::numeric < 0 or (v_value::text)::numeric > 2147483647
         or trunc((v_value::text)::numeric) <> (v_value::text)::numeric then perform shatsu.fail('INVALID_OPERATION'); end if;
    elsif v_field = 'title' then
      if jsonb_typeof(v_value) is distinct from 'string' then perform shatsu.fail('INVALID_OPERATION'); end if;
      if octet_length(op->>v_field) > (shatsu.limits()->>'maxTitleBytes')::int then perform shatsu.fail('LIMIT_EXCEEDED', '{"limit":"maxTitleBytes"}'); end if;
    elsif v_field = 'nodeKind' then
      if (op->>'nodeKind') is null or (op->>'nodeKind') not in ('folder', 'bookmark') then perform shatsu.fail('INVALID_OPERATION'); end if;
    elsif v_field = 'url' then
      if jsonb_typeof(v_value) is distinct from 'string' and v_value is distinct from 'null'::jsonb then perform shatsu.fail('INVALID_OPERATION'); end if;
      if op->>'nodeKind' = 'folder' and v_value is distinct from 'null'::jsonb then perform shatsu.fail('INVALID_OPERATION'); end if;
    elsif v_field = 'expectedSubtreeDigest' then
      if jsonb_typeof(v_value) is distinct from 'string' or (op->>v_field) !~ '^[0-9a-f]{64}$' then perform shatsu.fail('INVALID_OPERATION'); end if;
    elsif v_field = 'patch' then
      if jsonb_typeof(v_value) is distinct from 'object' then perform shatsu.fail('INVALID_OPERATION'); end if;
      if (v_value ? 'title' and jsonb_typeof(v_value->'title') is distinct from 'string')
         or (v_value ? 'url' and jsonb_typeof(v_value->'url') is distinct from 'string') then perform shatsu.fail('INVALID_OPERATION'); end if;
    elsif v_field = 'orderedChildIds' then
      if jsonb_typeof(v_value) is distinct from 'array' then perform shatsu.fail('INVALID_OPERATION'); end if;
      if exists (select 1 from jsonb_array_elements(v_value) x where jsonb_typeof(x) is distinct from 'string' or (x #>> '{}') !~ v_uuid_pattern) then perform shatsu.fail('INVALID_OPERATION'); end if;
    end if;
  end loop;
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
  if shatsu.node_depth(v_parent.id) + (select coalesce(max(shatsu.node_depth(s)), 1) from shatsu.live_subtree_ids(v_node.id) s) - shatsu.node_depth(v_node.id) + 1 > (v_lim->>'maxDepth')::int then
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
  if shatsu.node_depth(v_parent.id) + (select max(shatsu.node_depth(id)) from unnest(v_ids) id) - shatsu.node_depth(t.root_node_id) + 1 > (v_lim->>'maxDepth')::int then
    perform shatsu.fail('LIMIT_EXCEEDED', jsonb_build_object('limit', 'maxDepth'));
  end if;
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

create or replace function shatsu.apply_one(c shatsu.ctx_t, p_env jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
  op jsonb := p_env->'op'; v_op_id uuid; v_hash text; v_existing shatsu.operation_receipts; v_kind text;
  r jsonb; v_receipt jsonb; v_seq bigint; v_code text; v_detail text; v_lim jsonb := shatsu.limits();
begin
  if jsonb_typeof(p_env) is distinct from 'object'
     or jsonb_typeof(p_env->'protocolVersion') is distinct from 'number'
     or jsonb_typeof(p_env->'generationId') is distinct from 'string'
     or (p_env->>'generationId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     or jsonb_typeof(op) is distinct from 'object'
     or jsonb_typeof(op->'opId') is distinct from 'string' then
    return jsonb_build_object('opId', op->>'opId', 'status', 'rejected', 'code', 'INVALID_OPERATION');
  end if;
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
    perform shatsu.validate_operation(op);
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

create or replace function public.sync_apply_operations(p_envs jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c shatsu.ctx_t; v_code text; v_detail text; w shatsu.workspaces; e jsonb; r jsonb; v_receipts jsonb := '[]'::jsonb;
  v_stop boolean := false; v_applied boolean := false; v_lim jsonb := shatsu.limits();
begin
  c := shatsu.ctx();
  if jsonb_typeof(p_envs) is distinct from 'array' then perform shatsu.fail('INVALID_OPERATION'); end if;
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

create or replace function public.shatsu_can_subscribe(p_topic text) returns boolean
language sql security definer set search_path = '' as $$
  select exists (
    select 1 from shatsu.workspaces w
    join shatsu.devices d on d.workspace_id = w.id
    where w.owner_user_id = auth.uid() and w.status = 'active'
      and p_topic = 'workspace:' || w.id::text
      and d.auth_session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid
      and shatsu.session_valid(d.auth_session_id, auth.uid())
      and d.revoked_at is null
  )
$$;

revoke all on function shatsu.validate_operation(jsonb) from public, anon, authenticated;
