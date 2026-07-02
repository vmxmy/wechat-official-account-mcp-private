## ADDED Requirements

### Requirement: Upload by URL on Workers
The media tools (`wechat_media_upload`, `wechat_upload_img`, `wechat_permanent_media`) SHALL accept a `fileUrl` parameter: the system `fetch`es the URL, obtains bytes, validates type/size, and uploads to WeChat. This path SHALL NOT depend on a local filesystem.

#### Scenario: Upload from URL
- **WHEN** a client calls the upload tool with `fileUrl=https://.../pic.jpg` and a valid `type`
- **THEN** the Worker fetches the bytes, validates type/size, builds a Web `FormData`, and returns the WeChat `media_id` — with no filesystem access

### Requirement: R2-backed large/permanent media
The system SHALL use Cloudflare R2 to stage large or permanent media: uploads can target an R2 key, and the Worker reads the object via the R2 binding before forwarding to WeChat. Media egress to WeChat SHALL stay within the Cloudflare network to avoid egress fees.

#### Scenario: Upload from R2 key
- **WHEN** a client supplies an R2 key instead of a local path
- **THEN** the Worker reads the object from R2 and uploads it to WeChat without any bytes leaving the Cloudflare network

### Requirement: fileData upload remains available
The media tools SHALL accept base64 `fileData` for small files when clients cannot provide an HTTPS URL or R2 key, subject to type/size and Workers memory limits.

#### Scenario: Upload from fileData
- **WHEN** a client supplies a valid base64 `fileData` payload
- **THEN** the Worker decodes, validates, and uploads it without any local filesystem access

### Requirement: filePath removed
The `filePath` parameter SHALL be rejected with a clear error because the HTTP-only runtime has no local filesystem and the local stdio runtime has been removed.

#### Scenario: filePath rejected
- **WHEN** a client supplies `filePath` against the Worker deployment
- **THEN** the tool returns an error directing the caller to use `fileUrl`, `r2Key`, or `fileData`

### Requirement: Type and size validation preserved
Media uploads SHALL continue to enforce `ALLOWED_MEDIA_TYPES` and `FILE_SIZE_LIMITS`, and SHALL reject payloads that exceed the Workers 128 MB memory ceiling before attempting upload.

#### Scenario: Oversize file rejected before upload
- **WHEN** the resolved media exceeds its type's size limit or the Workers memory ceiling
- **THEN** the tool returns a validation error without contacting WeChat
