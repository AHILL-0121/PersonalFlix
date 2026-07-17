// ==== CONFIG ====
const ROOT_FOLDER_ID = "1EYD7UQS1BerqNyMM3kGqTeZ_E2Pj0FWS";
const GITHUB_OWNER = "AHILL-0121";
const GITHUB_REPO = "PersonalFlix";
const GITHUB_TOKEN = PropertiesService.getScriptProperties().getProperty("GITHUB_TOKEN");

// ==== MAIN POLL FUNCTION (attach a time-driven trigger to this) ====
function pollForMkvFiles() {
  const processed = getProcessedSet();
  const folderIds = getAllSubfolderIds(ROOT_FOLDER_ID);
  folderIds.push(ROOT_FOLDER_ID);

  for (const folderId of folderIds) {
    const folder = DriveApp.getFolderById(folderId);
    const it = folder.getFiles();
    while (it.hasNext()) {
      const file = it.next();
      const name = file.getName();
      if (name.toLowerCase().endsWith(".mkv") && !processed.has(file.getId())) {
        dispatchConversion(file.getId(), name, folderId);
        markProcessed(file.getId());
      }
    }
  }
}

// ==== Recursively collect all subfolder IDs ====
function getAllSubfolderIds(rootId) {
  const result = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const folder = DriveApp.getFolderById(currentId);
    const subfolders = folder.getFolders();
    while (subfolders.hasNext()) {
      const sub = subfolders.next();
      result.push(sub.getId());
      queue.push(sub.getId());
    }
  }
  return result;
}

/**
 * Create a Google Drive resumable upload session AS THE SCRIPT USER.
 * Returns the upload URL (Location header). The URL is valid for 7 days.
 * Because this runs under the user's OAuth token (ScriptApp.getOAuthToken()),
 * any bytes uploaded to this URL count against the USER's quota — not the
 * service account's (which has zero quota).
 *
 * @param {string} name       - Target filename in Drive (e.g. "Movie.mp4")
 * @param {string} parentId   - Drive folder ID for the uploaded file
 * @param {string} mimeType   - MIME type of the file to be uploaded
 * @returns {string}          - Resumable upload URL
 */
function initiateResumableUpload(name, parentId, mimeType) {
  const token = ScriptApp.getOAuthToken();
  const resp = UrlFetchApp.fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "post",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
      },
      payload: JSON.stringify({ name: name, parents: [parentId] }),
      muteHttpExceptions: true,
    }
  );

  const code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error(
      "Failed to initiate resumable upload for " + name +
      ": HTTP " + code + " — " + resp.getContentText().substring(0, 300)
    );
  }

  const location = resp.getHeaders()["Location"];
  if (!location) {
    throw new Error("No Location header in upload initiation response for " + name);
  }
  Logger.log("Upload URL created for: " + name);
  return location;
}

// ==== Trigger GitHub Actions via repository_dispatch ====
function dispatchConversion(fileId, fileName, parentId) {
  const baseName = fileName.replace(/\.mkv$/i, "");

  // Create a pre-authorized upload session for the converted MP4.
  // This runs as your Google account, so the file lands in YOUR Drive quota.
  const mp4UploadUrl = initiateResumableUpload(baseName + ".mp4", parentId, "video/mp4");

  // Pre-create upload slots for up to 3 sidecar SRT subtitle tracks.
  // Unused slots expire harmlessly after 7 days.
  const srtUploadUrls = [];
  for (let i = 0; i < 3; i++) {
    try {
      const srtName = i === 0 ? baseName + ".srt" : baseName + ".track" + i + ".srt";
      srtUploadUrls.push(
        initiateResumableUpload(srtName, parentId, "application/x-subrip")
      );
    } catch (e) {
      Logger.log("SRT slot " + i + " init failed: " + e);
      break; // stop attempting further slots if we hit an error
    }
  }

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;
  const payload = {
    event_type: "convert_mkv",
    client_payload: {
      file_id: fileId,
      file_name: fileName,
      parent_id: parentId,
      mp4_upload_url: mp4UploadUrl,
      srt_upload_urls: srtUploadUrls.join(","), // comma-separated for easy env var passing
    },
  };
  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  const response = UrlFetchApp.fetch(url, options);
  Logger.log(`Dispatched ${fileName}: ${response.getResponseCode()}`);
}

// ==== Track already-processed file IDs so we don't re-trigger ====
function getProcessedSet() {
  const stored = PropertiesService.getScriptProperties().getProperty("PROCESSED_IDS");
  return new Set(stored ? JSON.parse(stored) : []);
}

function markProcessed(fileId) {
  const set = getProcessedSet();
  set.add(fileId);
  // Keep the list from growing forever, trim if it gets too large
  const arr = Array.from(set).slice(-2000);
  PropertiesService.getScriptProperties().setProperty("PROCESSED_IDS", JSON.stringify(arr));
}
