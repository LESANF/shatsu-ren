-- 서버 북마크(collection) 통째 삭제. 노드·순서는 FK cascade, 휴지통 항목도 같이 지운다.
-- 다른 브라우저는 deleteCollection commit 을 받아 연결만 끊고 로컬 폴더는 남긴다. Idempotent.

create or replace function public.sync_delete_collection(p_collection_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c shatsu.ctx_t; v_code text; v_detail text; v_seq bigint; n int;
begin
  c := shatsu.ctx();
  perform 1 from shatsu.workspaces where id = c.workspace_id for update;
  delete from shatsu.collections where id = p_collection_id and workspace_id = c.workspace_id;
  get diagnostics n = row_count;
  if n = 0 then perform shatsu.fail('NOT_FOUND'); end if;
  delete from shatsu.trash_payloads where workspace_id = c.workspace_id and collection_id = p_collection_id;
  update shatsu.workspaces set head_seq = head_seq + 1 where id = c.workspace_id returning head_seq into v_seq;
  insert into shatsu.commits (workspace_id, seq, source_device_id, op_id, kind, payload)
    values (c.workspace_id, v_seq, c.device_id, gen_random_uuid(), 'deleteCollection',
      jsonb_build_object('collections', '[]'::jsonb, 'nodes', '[]'::jsonb, 'orders', '[]'::jsonb,
        'deletedCollectionId', p_collection_id));
  perform shatsu.notify_changed(c.workspace_id);
  return jsonb_build_object('ok', true, 'data', jsonb_build_object('seq', v_seq));
exception when sqlstate 'SR001' then
  get stacked diagnostics v_code = message_text, v_detail = pg_exception_detail;
  return shatsu.err_to_json(v_code, v_detail);
end $$;

revoke all on function public.sync_delete_collection(uuid) from public, anon, authenticated;
grant execute on function public.sync_delete_collection(uuid) to authenticated;
