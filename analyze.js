const fs = require('fs').promises;
const child_process = require('child_process');
const { promisify } = require('util');
const exec = promisify(child_process.exec);
const got = require('got');

const {
  GITHUB_EVENT_PATH
} = process.env;

const client = got.extend({
  timeout: 5000,
  responseType: 'json',
  hooks: {
    afterResponse: [(response, retryWithMergedOptions) => {
      if (response && response.statusCode === 409 && response.body) {
        const updatedOptions = {
          headers: {
            'X-Transmission-Session-Id': response.headers['X-Transmission-Session-Id'.toLowerCase()]
          }
        };
        client.defaults.options = got.mergeOptions(client.defaults.options, updatedOptions);
        return retryWithMergedOptions(updatedOptions);
      }
      return response;
    }]
  }
});

function formatSize(size, unit) {
  let byte = 0;
  if (unit) formatUnit = unit.toUpperCase();
  else byte = Number(size);
  switch (formatUnit) {
    case 'K': {
      byte = Number(size) * 1024;
      break;
    }
    case 'M': {
      byte = Number(size) * 1024 * 1024;
      break;
    }
    case 'G': {
      byte = Number(size) * 1024 * 1024 * 1024;
      break;
    }
    case 'T': {
      byte = Number(size) * 1024 * 1024 * 1024 * 1024;
      break;
    }
    case 'P': {
      byte = Number(size) * 1024 * 1024 * 1024 * 1024 * 1024;
      break;
    }
  }
  return Math.ceil(byte);
}

function processOutput(output, lastIndex = 0) {
  const maxSize = 400 * 1024 * 1024;
  const singleFileMaxSize = 12 * 1024 * 1024 * 1024;
  const [header, list] = output.split('\nFILES\n');
  const hash = header.match(/  Hash: (.*)/)[1];
  const filterResult = list.replace(/\n*$/, '').split('\n  ');
  filterResult.shift();
  const matchResult = filterResult.map((item, index) => {
    const [, name, size, unit] = item.match(/^(.*) \((.*?) (P|T|G|M|k)?B\)$/);
    return { index: index + 1, name, size: formatSize(size, unit) };
  }).filter(item => item.index > Number(lastIndex)).filter(item => !/_____padding_file_\d+_/.test(item.name));
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
      if (taskTemp.length === 0) {
        queue.push([item.index]);
        totalSizeTemp = 0;
        return;
      }
      else {
        queue.push(taskTemp);
        taskTemp = [];
        totalSizeTemp = item.size;
      }
    }
    taskTemp.push(item.index);
    if (index === matchResult.length - 1) queue.push(taskTemp);
  });
  if (bigFiles.length > 0) {
    console.log('以下文件因过大而忽略：');
    console.log(`magnet:?xt=urn:btih:${hash}`);
  }
  bigFiles.forEach(file => console.log(file));
  return queue;
}

(async () => {
  try {
    const files = await fs.readdir('./');
    const torrent = files.find((item) => /\.torrent$/.test(item));
    const tasks = [];
    if (!torrent) throw '获取种子文件失败';
    const event = JSON.parse(await fs.readFile(GITHUB_EVENT_PATH));
    const {
      file: lastIndex
    } = event.inputs || {};
    const { stdout: output, stderr } = await exec(`transmission-show "${torrent}"`);
    if (stderr) throw stderr;
    if (output) {
      const list = processOutput(output, lastIndex);
      tasks.push(...list);
    }
    else throw 'Aria2解析种子命令无输出';
    const task = tasks.shift();
    if (!task) throw '分解种子任务失败';
    await fs.writeFile('list.txt', `${torrent}\r\n  select-file=${task.join(',')}`);
    const last = task[task.length - 1];
    if (tasks.length === 0) await fs.writeFile('last-file.txt', 'none');
    else {
      await fs.writeFile('last-file.txt', `${last}`);
      const torrentBase64 = (await fs.readFile(torrent)).toString('base64');
      await client.post('http://localhost:9091/transmission/rpc', {
        json: {
          method: 'torrent-add',
          arguments: {
            'files-unwanted': tasks.flat(),
            paused: false,
            metainfo: torrentBase64
          }
        }
      });
    }
  }
  catch (error) {
    console.log(error);
    if (error.response && error.response.body) console.log(error.response.body);
    process.exit(1);
  }
})();
