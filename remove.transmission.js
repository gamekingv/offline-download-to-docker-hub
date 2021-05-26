const fs = require('fs');
const fsp = fs.promises;
const got = require('got');

const [, , id] = process.argv;

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
    const { body: taskInfo } = await client.post('http://localhost:9091/transmission/rpc', {
      json: {
        method: 'torrent-get',
        arguments: {
          fields: [
            'files',
          ],
          ids: [Number(id)]
        }
      }
    });
    if (!taskInfo) throw '获取种子信息失败';
    const files = [];
    const { files: torrentFiles } = taskInfo.arguments.torrents[0];
    if (torrentFiles) {
      files.push(...torrentFiles.map(({ name, length }, index) => ({ index, name, size: length })).filter(item => !/_____padding_file_\d+_/.test(item.name)));
    }
    else throw '无法解析种子';
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
    await client.post('http://localhost:9091/transmission/rpc', {
      json: {
        method: 'torrent-stop',
        arguments: {
          ids: [Number(id)]
        },
      }
    });
  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
})();