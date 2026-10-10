DROP TABLE IF EXISTS documents;
DROP TABLE IF EXISTS section_documents;
DROP TABLE IF EXISTS proposal_sections;
DROP TABLE IF EXISTS content_block_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS content_block_versions;
DROP TABLE IF EXISTS content_blocks;
ALTER TABLE proposals DROP COLUMN folder_path, ADD COLUMN sp_drive_id VARCHAR(255), ADD COLUMN sp_folder_item_id VARCHAR(255);
