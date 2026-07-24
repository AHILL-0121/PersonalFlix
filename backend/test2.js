const { spawn } = require('child_process');
const ffmpegStatic = require('ffmpeg-static');
const { google } = require('googleapis');
require('dotenv').config();

async function test() {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const { client_email, private_key } = JSON.parse(keyJson);
    const auth = new google.auth.JWT(client_email, null, private_key, ['https://www.googleapis.com/auth/drive.readonly']);
    const token = (await auth.getAccessToken()).token;

    const fileId = '1v9KTary9kuk8VxktA3Zb-PNUT_b1_5Em';
    const fileUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true&acknowledgeAbuse=true`;
    const args = [
        '-headers', `Authorization: Bearer ${token}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n`,
        '-i', fileUrl,
        '-f', 'null', '-'
    ];
    const ffmpeg = spawn(ffmpegStatic, args);
    ffmpeg.stderr.on('data', d => process.stdout.write(d));
    ffmpeg.on('close', c => process.exit(c));
}
test();
