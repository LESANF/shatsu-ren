-- generated from packages/protocol/src/vectors.json — SQL digest 가 TS 와 동일한지 검증
begin;
select plan(9);
select is(shatsu.digest_input('[]'::jsonb, '[]'::jsonb), E'', 'digest_input empty');
select is(shatsu.digest_hex(shatsu.digest_input('[]'::jsonb, '[]'::jsonb)), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'sha256 empty');
select is(shatsu.digest_input('[{"id": "00000000-0000-4000-8000-000000000001", "revision": 3, "parentId": "00000000-0000-4000-8000-000000000000", "deleted": false}]'::jsonb, '[]'::jsonb), E'N 00000000-0000-4000-8000-000000000001 3 00000000-0000-4000-8000-000000000000 0\n', 'digest_input single-bookmark-under-root');
select is(shatsu.digest_hex(shatsu.digest_input('[{"id": "00000000-0000-4000-8000-000000000001", "revision": 3, "parentId": "00000000-0000-4000-8000-000000000000", "deleted": false}]'::jsonb, '[]'::jsonb)), 'be63b6d653f4579502c73a3037679f6e3f02022fa5e2bb28cad76fd1006e0aeb', 'sha256 single-bookmark-under-root');
select is(shatsu.digest_input('[{"id": "00000000-0000-4000-8000-00000000000b", "revision": 1, "parentId": "00000000-0000-4000-8000-00000000000a", "deleted": false}, {"id": "00000000-0000-4000-8000-00000000000a", "revision": 7, "parentId": null, "deleted": false}, {"id": "00000000-0000-4000-8000-000000000003", "revision": 2, "parentId": "00000000-0000-4000-8000-00000000000a", "deleted": true}]'::jsonb, '[{"parentId": "00000000-0000-4000-8000-00000000000a", "revision": 4, "orderedChildIds": ["00000000-0000-4000-8000-00000000000b"]}]'::jsonb), E'N 00000000-0000-4000-8000-000000000003 2 00000000-0000-4000-8000-00000000000a 1\nN 00000000-0000-4000-8000-00000000000a 7 - 0\nN 00000000-0000-4000-8000-00000000000b 1 00000000-0000-4000-8000-00000000000a 0\nO 00000000-0000-4000-8000-00000000000a 4 00000000-0000-4000-8000-00000000000b\n', 'digest_input folder-with-two-children-unsorted-input');
select is(shatsu.digest_hex(shatsu.digest_input('[{"id": "00000000-0000-4000-8000-00000000000b", "revision": 1, "parentId": "00000000-0000-4000-8000-00000000000a", "deleted": false}, {"id": "00000000-0000-4000-8000-00000000000a", "revision": 7, "parentId": null, "deleted": false}, {"id": "00000000-0000-4000-8000-000000000003", "revision": 2, "parentId": "00000000-0000-4000-8000-00000000000a", "deleted": true}]'::jsonb, '[{"parentId": "00000000-0000-4000-8000-00000000000a", "revision": 4, "orderedChildIds": ["00000000-0000-4000-8000-00000000000b"]}]'::jsonb)), 'b3c173765cbf81485b523a80e9c1b425ca97351e0cb4e7c724e43bd39bbf1a20', 'sha256 folder-with-two-children-unsorted-input');
-- 권한: authenticated 는 shatsu 스키마·내부 함수·테이블에 접근 불가
select throws_like($$ set role authenticated; select count(*) from shatsu.nodes; $$, '%permission denied%', 'authenticated cannot read shatsu.nodes');
reset role;
select throws_like($$ set role anon; select public.sync_info(); $$, '%permission denied%', 'anon cannot execute sync_info');
reset role;
select throws_like($$ set role authenticated; select public.account_deletion_begin(gen_random_uuid(), gen_random_uuid()); $$, '%permission denied%', 'authenticated cannot begin account deletion');
reset role;
select * from finish();
rollback;
