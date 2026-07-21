const fetch = require('node-fetch');

async function test() {
    const r = await fetch("https://personalflix.onrender.com/api/tracks/1mQT9U3Hdg-9QQm9blxfbe6MoyLze1VDJ");
    console.log(await r.text());
}

test();
