const fs = require('fs').promises;
const { exec } = require('child_process');

function processOutput(output) {
  const maxSize = 10 * 1024 * 1024 * 1024;
  const singleFileMaxSize = 13 * 1024 * 1024 * 1024;
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
  if (bigFiles.length > 0) console.log('以下文件因过大而忽略：');
  bigFiles.forEach(file => console.log(file));
  return taskList;
}

(async () => {
  const files = await fs.readdir('./');
  const torrents = files.filter((item) => /\.torrent$/.test(item));
  const execP = await new Promise((res, rej) => exec(cmd, (err, stdout, stderr) => err ? rej(stderr) : res(stdout)));
  const tasks = [];
  for (const torrent of torrents) {
    const output = await execP(`aria2c -S "${torrent}"`);
    if (output) {
      const list = processOutput(output);
      tasks.push(...list);
    }
    else '命令无输出';
  }
  let count = 0;
  tasks.forEach(task => {
    console.log(count++);
    console.log(task);
  });
})();