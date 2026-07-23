alter table users
  add column employment_doc_name text,
  add column employment_doc_mime text,
  add column employment_doc_data bytea,
  add column employment_doc_uploaded_at timestamptz,
  add column employment_doc_uploaded_by uuid references users(id);
