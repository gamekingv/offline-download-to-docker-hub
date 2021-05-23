const fs = require('fs').promises;
const child_process = require('child_process');
const { promisify } = require('util');
const exec = promisify(child_process.exec);
const got = require('got');

const {
  GITHUB_REPOSITORY: repository,
  QUEUE_DISPATCH_TOKEN: token
} = process.env;

const client = got.extend({
  headers: {
    'User-Agent': 'Github Actions'
  },
  timeout: 10000,
  responseType: 'json'
});

function processOutput(output) {
  const maxSize = 400 * 1024 * 1024;
  const singleFileMaxSize = 12 * 1024 * 1024 * 1024;
  const [header, result] = output.split('\n===+===========================================================================\n');
  const hash = header.match(/Info Hash:\s*(.*)/)[1];
  const list = result.split('\n---+---------------------------------------------------------------------------\n');
  const filterResult = list.filter(item => !/_____padding_file_\d+_/.test(item));
  filterResult.pop();
  const matchResult = filterResult.map(item => {
    const [, index, name, size] = item.match(/^\s*(\d+)\|(.*)\n\s*\|[^(]+ \(([^)]+)\)$/);
    return { index: Number(index), name, size: Number(size.replace(/,/g, '')) };
  });
  const queue = [];
  let totalSizeTemp = 0;
  let taskTemp = [];
  const bigFiles = [];
  matchResult.forEach((item, index) => {
    if (item.size > singleFileMaxSize) {
      bigFiles.push(`${item.name}：${(item.size / (1024 * 1024 * 1024)).toFixed(2)}GB`);
      return;
    }
    totalSizeTemp += item.size;
    if (totalSizeTemp >= maxSize) {
      queue.push(taskTemp);
      taskTemp = [];
      totalSizeTemp = item.size;
    }
    taskTemp.push(item.index);
    if (index === matchResult.length - 1) queue.push(taskTemp);
  });
  const taskList = queue.map(files => {
    const list = files.reduce((result, file, index) => {
      if (file === files[index + 1] - 1) {
        if (result.charAt(result.length - 1) === ',' || result.length === 0) return result += `${file}`;
        else if (result.charAt(result.length - 1) !== '-') return result += '-';
        else return result;
      }
      else return result += `${file},`;
    }, '');
    return `magnet:?xt=urn:btih:${hash}\r\n  select-file=${list.slice(0, -1)}`;
  });
  if (bigFiles.length > 0) {
    console.log('以下文件因过大而忽略：');
    console.log(`magnet:?xt=urn:btih:${hash}`);
  }
  bigFiles.forEach(file => console.log(file));
  return taskList;
}

async function sendToDownload(remote, local) {
  const content = Buffer.from(local).toString('base64'),
    configLink = remote,
    body = {
      message: '大文件种子下载推送',
      content
    },
    headers = {
      'Authorization': `token ${token}`,
      'User-Agent': 'Github Actions'
    };
  if (!content) return 'empty';
  const response = await client.get(configLink, {
    headers
  });
  body.sha = response.body.sha;
  await client.put(configLink, {
    headers,
    json: body
  });
}

(async () => {
  try {
    const files = await fs.readdir('./');
    const torrents = files.filter((item) => /\.torrent$/.test(item));
    const tasks = [];
    for (const torrent of torrents) {
      const { stdout: output, stderr } = await exec(`aria2c -S "${torrent}"`);
      if (stderr) throw stderr;
      if (output) {
        const list = processOutput(output);
        tasks.push(...list);
      }
      else '命令无输出';
    }
    for (const task of tasks) {
      try {
        await sendToDownload(`https://api.github.com/repos/${repository}/contents/list.txt`, task);
        console.log('');
        console.log(task);
        console.log('任务发送成功');
        await new Promise(res => setTimeout(() => res(), 30000));
      }
      catch (error) {
        console.log('');
        console.log(task);
        console.log('任务发送失败：');
        console.log(error);
        if (error.response && error.response.body) console.log(error.response.body);
      }
    }
  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
})();
