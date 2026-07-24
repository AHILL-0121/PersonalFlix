const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { google } = require('googleapis');
require('dotenv').config({ path: './backend/.env' });

async function test() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const { client_email, private_key } = JSON.parse(keyJson);
    const auth = new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/drive.readonly']);
    const token = (await auth.getAccessToken()).token;

    const fileId = '1Jo50GEfeMvsv0i4KSj5QOoasuStxVJFf';
    const fileUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true&access_token=${token}`;
    const args = [
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        '-i', fileUrl,
        '-f', 'null', '-'
    ];
    const ffmpeg = spawn(ffmpegStatic, args);
    ffmpeg.stderr.on('data', d => process.stdout.write(d));
    ffmpeg.on('close', c => process.exit(c));
}
test();
