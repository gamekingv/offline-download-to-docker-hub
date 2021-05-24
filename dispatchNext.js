const fs = require('fs').promises;
const got = require('got');

const {
  GITHUB_REPOSITORY: repository,
  QUEUE_DISPATCH_TOKEN: dispatchToken
} = process.env;

const client = got.extend({
  headers: {
    'User-Agent': 'Github Actions'
  },
  timeout: 10000,
  responseType: 'json'
});

async function executeTask({ torrent, file }) {
  const body = JSON.stringify({
    ref: 'main',
    inputs: {
      type: 'torrent',
      torrent,
      file
    }
  });
  await client.post(`https://api.github.com/repos/${repository}/actions/workflows/big-torrent-download.yml/dispatches`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${dispatchToken}`
    },
    body,
  });
}

(async () => {
  try {
    const files = await fs.readdir('./');
    const torrent = files.find((item) => /\.torrent$/.test(item));
    const lastIndex = `${await fs.readFile('last-file.txt')}`;
    if (lastIndex === 'none') return console.log('无后续任务');
    const base64 = Buffer.from(await fs.readFile(torrent)).toString('base64');
    executeTask({ torrent: base64, file: lastIndex });
  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
})();
