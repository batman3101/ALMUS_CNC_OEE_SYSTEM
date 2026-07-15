-- Storage: remove anonymous listing of the public 'company-assets' bucket
-- (public_bucket_allows_listing advisory).
--
-- The bucket is public, so objects are served via public URLs (getPublicUrl in
-- src/app/api/upload/image/route.ts) WITHOUT needing an RLS SELECT policy on storage.objects.
-- The broad "읽기 허용" SELECT policy (bucket_id check only, role public) only enabled anonymous
-- enumeration of every file. The app never lists the bucket (no .list()/.download() usage), so
-- the listing policy is removed. Upload (INSERT) and update policies for authenticated users are
-- left intact.
DROP POLICY IF EXISTS "company-assets 읽기 허용" ON storage.objects;
