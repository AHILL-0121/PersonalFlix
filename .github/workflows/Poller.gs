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
 * Create an empty placeholder file owned by YOUR Google account.
 * Because you own it, any content the SA writes to it is charged to YOUR
 * Drive quota — not the SA's (which has zero quota).
 *
 * @param {string} name      - Filename (e.g. "Movie.mp4")
 * @param {string} parentId  - Drive folder ID
 * @param {string} mimeType  - MIME type string
 * @returns {string}         - File ID of the created placeholder
 */
function createPlaceholderFile(name, parentId, mimeType) {
  const folder = DriveApp.getFolderById(parentId);
  // createFile(name, content, mimeType) — empty string content = zero-byte placeholder
  const file = folder.createFile(name, "", mimeType);
  Logger.log("Created placeholder: " + name + " → " + file.getId());
  return file.getId();
}

// ==== Trigger GitHub Actions via repository_dispatch ====
function dispatchConversion(fileId, fileName, parentId) {
  const baseName = fileName.replace(/\.mkv$/i, "");

  // Create an empty user-owned placeholder. The SA will overwrite its content
  // with the converted MP4. Storage charged to you (the file owner), not the SA.
  const placeholderId = createPlaceholderFile(
    baseName + ".mp4",
    parentId,
    "video/mp4"
  );

  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/dispatches`;
  const payload = {
    event_type: "convert_mkv",
    client_payload: {
      file_id: fileId,
      file_name: fileName,
      parent_id: parentId,
      placeholder_id: placeholderId,   // SA will UPDATE this file, not CREATE a new one
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
