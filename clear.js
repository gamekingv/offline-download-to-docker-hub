const request = require('request');
const fs = require('fs');

const [, , repository, token, dispatchToken] = process.argv;

async function saveDownloadedList(filename, downloadedList) {
  let content = Buffer.from(downloadedList).toString('base64'),
    timeStamp = Date.now(),
    commitLink = `https://api.github.com/repos/${repository}/commits`,
    configLink = `https://api.github.com/repos/${repository}/contents/${filename}`,
    body = {
      message: `更新于${new Date(timeStamp).toLocaleString()}`,
      content
    },
    headers = {
      'Authorization': `token ${token}`,
      'User-Agent': 'Github Actions'
    };
  const response = await new Promise((res, rej) => {
    request(commitLink, {
      headers,
      timeout: 10000
    }, function (error, response) {
      if (error) return rej(error);
      else res(response);
    });
  });
  tree_sha = JSON.parse(response.body)[0].commit.tree.sha;

  const treeResponse = await new Promise((res, rej) => {
    request(`https://api.github.com/repos/${repository}/git/trees/${tree_sha}`, {
      headers,
      timeout: 10000
    }, function (error, response) {
      if (error) return rej(error);
      else res(response);
    });
  });
  const file = JSON.parse(treeResponse.body).tree.find(file => file.path === filename);
  body.sha = file.sha;
  await new Promise((res, rej) => {
    request(configLink, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body),
      timeout: 10000
    }, function (error, response) {
      if (error) return rej(error);
      else res(response);
    });
  });
}

function triggerNext() {
  return new Promise((res, rej) => {
    const body = JSON.stringify({ ref: 'main' });
    request(`https://api.github.com/repos/${repository}/actions/workflows/google-drive-download.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        'Authorization': `token ${dispatchToken}`,
        'User-Agent': 'Manual'
      },
      body,
      timeout: 10000
    }, function (error, response) {
      if (error) return rej(error);
      else res(response);
    });
  });
}

function mapDirectory(root) {
  const filesArr = [];
  root += '/';
  (function dir(dirpath) {
    const files = fs.readdirSync(dirpath);
    files.forEach((item) => {
      const info = fs.statSync(dirpath + item);
      if (info.isDirectory()) {
        dir(dirpath + item + '/');
      } else {
        filesArr.push(dirpath + item);
      }
    });
  })(root);
  return filesArr;
}

(async () => {
  try {
    const uploadedFiles = mapDirectory('Offline');
    const files = JSON.parse(fs.readFileSync('google-drive-list.json'));
    const remainFiles = files.filter(file => !uploadedFiles.some(uploadedFile => uploadedFile === `${file.path}/${file.name}`));
    await saveDownloadedList('google-drive-list.json', JSON.stringify(remainFiles, null, 2));
    if (remainFiles.length > 0) {
      console.log(`成功处理 ${uploadedFiles.length} 个文件`);
      console.log(`剩余 ${remainFiles.length} 个文件，将在下一次Actions下载`);
      if (uploadedFiles.length > 35) {
        await triggerNext();
        console.log('成功触发下一次任务');
      }
      else {
        console.log('较多文件下载失败，停止触发下一次任务');
        process.exit(1);
      }
    }
  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
})();
