const fs = require('fs').promises;
const got = require('got');

const {
  GITHUB_EVENT_PATH
} = process.env;

let client = got.extend({
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
        client = client.extend(updatedOptions);
        return retryWithMergedOptions(updatedOptions);
      }
      return response;
    }]
  }
});

function processOutput(output, lastIndex = -1) {
  const maxSize = 1024 * 1024 * 1024;
  const singleFileMaxSize = 13 * 1024 * 1024 * 1024;
  const files = output.map(({ name, length }, index) => ({ index, name, size: length })).filter(item => item.index > Number(lastIndex));
  const paddingFiles = files.filter(item => /_____padding_file_\d+_/.test(item.name)).map(item => item.index);
  const matchResult = files.filter(item => !/_____padding_file_\d+_/.test(item.name));
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
  }
  bigFiles.forEach(file => console.log(file));
  queue.push(paddingFiles);
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
    const downloadedFiles = [];
    if (lastIndex) downloadedFiles.push(...Array(Number(lastIndex) + 1).keys());
    const torrentBase64 = (await fs.readFile(torrent)).toString('base64');
    const { body: addResponse } = await client.post('http://localhost:9091/transmission/rpc', {
      json: {
        method: 'torrent-add',
        arguments: {
          paused: true,
          metainfo: torrentBase64
        }
      }
    });
    const taskID = addResponse.arguments['torrent-added'].id;
    if (!taskID) throw '添加种子失败';
    const { body: taskInfo } = await client.post('http://localhost:9091/transmission/rpc', {
      json: {
        method: 'torrent-get',
        arguments: {
          fields: [
            'files',
          ],
          ids: [taskID]
        }
      }
    });
    if (!taskInfo) throw '获取种子信息失败';
    const { files: torrentFiles } = taskInfo.arguments.torrents[0];
    let paddingFiles;
    if (torrentFiles) {
      const list = processOutput(torrentFiles, lastIndex);
      paddingFiles = list.pop();
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
    }
    console.log('task:' + JSON.stringify(task));
    console.log('downloadedFiles:' + JSON.stringify(downloadedFiles));
    console.log('tasks.flat():' + JSON.stringify(tasks.flat()));
    console.log('paddingFiles:' + JSON.stringify(paddingFiles));
    console.log('files-unwanted:' + JSON.stringify(downloadedFiles.concat(tasks.flat(), paddingFiles)));
    console.log('task:' + JSON.stringify(task));
    await client.post('http://localhost:9091/transmission/rpc', {
      json: {
        method: 'torrent-set',
        arguments: {
          'files-unwanted': downloadedFiles.concat(tasks.flat(), paddingFiles),
          ids: [taskID]
        },
      }
    });
    await client.post('http://localhost:9091/transmission/rpc', {
      json: {
        method: 'torrent-start',
        arguments: {
          ids: [taskID]
        },
      }
    });
    console.log(taskID);
  }
  catch (error) {
    console.log(error);
    if (error.response && error.response.body) console.log(error.response.body);
    process.exit(1);
  }
})();
