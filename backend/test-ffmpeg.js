const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { google } = require('googleapis');

async function test() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    if (!keyJson) return console.log("Missing key");
    const { client_email, private_key } = JSON.parse(keyJson);
    const auth = new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/drive.readonly']);
    const token = (await auth.getAccessToken()).token;

    const fileId = "1mQT9U3Hdg-9QQm9blxfbe6MoyLze1VDJ";
    const fileUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;

    const args = [
        "-nostdin",
        "-probesize", "5000000",
        "-analyzeduration", "3000000",
        "-fflags", "+genpts+nobuffer+discardcorrupt",
        "-i", fileUrl,
        "-map", "0:v:0",
        "-map", `0:a:0`,
        "-c:v", "copy",
        "-c:a", "aac",
        "-b:a", "192k",
        "-af", "aresample=async=1",
        "-avoid_negative_ts", "make_zero",
        "-movflags", "frag_keyframe+empty_moov+default_base_moof",
        "-f", "mp4",
        "pipe:1"
    ];

    console.log("running ffmpeg...");
    const ffmpeg = spawn(ffmpegStatic, args);
    ffmpeg.stderr.on('data', d => process.stdout.write(d));
    ffmpeg.on('close', c => console.log('exited with code', c));
}
test();
