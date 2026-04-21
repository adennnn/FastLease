/**
 * Workspace lifecycle helpers — create, upload files, delete.
 *
 * Used by warm-account (profile/cover photos) and post-listing (listing photos).
 */

import type { BrowserUseClient } from './client'

export interface WorkspaceFile {
  name: string
  contentType: string
  buffer: Buffer
}

/**
 * Create a workspace, upload files into it, and return the workspace ID.
 * Returns `null` if creation or upload fails (caller should skip photo steps).
 */
export async function createAndUpload(
  client: BrowserUseClient,
  prefix: string,
  files: WorkspaceFile[],
): Promise<string | null> {
  if (files.length === 0) return null

  try {
    const ws = await client.workspaces.create({ name: `${prefix}-${Date.now()}` })
    const workspaceId = ws.id

    const uploadRes = await client.workspaces.uploadFiles(workspaceId, {
      files: files.map(f => ({
        name: f.name,
        contentType: f.contentType,
        size: f.buffer.length,
      })),
    })

    await Promise.all(
      uploadRes.files.map((fileRes: any, i: number) =>
        fetch(fileRes.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': files[i].contentType },
          body: files[i].buffer as unknown as BodyInit,
        }).then(r => {
          if (!r.ok) throw new Error(`PUT ${files[i].name} failed: ${r.status}`)
        }),
      ),
    )

    console.log(`[Workspace] Uploaded ${files.length} file(s) to ${workspaceId}`)
    return workspaceId
  } catch (err: any) {
    console.log(`[Workspace] Upload failed: ${err.message}`)
    return null
  }
}

/** Best-effort workspace cleanup. */
export async function deleteWorkspace(
  client: BrowserUseClient,
  workspaceId: string | null,
): Promise<void> {
  if (!workspaceId) return
  try {
    await client.workspaces.delete(workspaceId)
    console.log(`[Workspace] Deleted ${workspaceId}`)
  } catch {}
}
