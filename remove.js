const fs = require('fs');
const fsp = fs.promises;
const child_process = require('child_process');
const { promisify } = require('util');
const exec = promisify(child_process.exec);

function processOutput(output) {
  const [, list] = output.split('\nFILES\n');
  const filterResult = list.replace(/\n*$/, '').split('\n  ').filter(item => !/_____padding_file_\d+_/.test(item));
  filterResult.shift();
  const matchResult = filterResult.map((item, index) => {
    const [, name,] = item.match(/^(.*)\((.*?) (P|T|G|M|k)?B\)$/);
    return { index: index + 1, name };
  });
  return matchResult;
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
    const list = `${await fsp.readFile('list.txt')}`;
    if (!list.includes('  select-file=')) return;
    const selected = list.match(/  select-file=(.*)/)[1].split(',').map(index => Number(index));
    if (!selected) throw '读取选中文件失败';
    const torrent = (await fsp.readdir('./Offline')).find((item) => /\.torrent$/.test(item));
    if (!torrent) throw '读取种子文件失败';
    const files = [];
    const { stdout: output, stderr } = await exec(`transmission-show "Offline/${torrent}"`);
    if (stderr) throw stderr;
    if (output) {
      const list = processOutput(output);
      files.push(...list);
    }
    else throw 'Aria2命令无输出';
    const selectedFiles = files.filter(file => selected.some(index => index === file.index));
    const downloadedFiles = mapDirectory('Offline');
    const removeFiles = downloadedFiles.filter(file => !selectedFiles.some(selectedFile => `Offline/${selectedFile.name}` === file));
    if (removeFiles.length > 0) {
      console.log('清理多余文件：');
      for (const file of removeFiles) {
        console.log(file);
        await fsp.unlink(file);
      }
    }
  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
})();
