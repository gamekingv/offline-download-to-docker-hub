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

function formatSize(size, denominator = 1024) {
  if (size < denominator) return `${size} B`;
  else if (size < Math.pow(denominator, 2)) return `${(size / denominator).toFixed(0)} KB`;
  else if (size < Math.pow(denominator, 3)) return `${(size / Math.pow(denominator, 2)).toFixed(2)} MB`;
  else if (size < Math.pow(denominator, 4)) return `${(size / Math.pow(denominator, 3)).toFixed(2)} GB`;
  else if (size < Math.pow(denominator, 5)) return `${(size / Math.pow(denominator, 4)).toFixed(2)} TB`;
  else if (size < Math.pow(denominator, 6)) return `${(size / Math.pow(denominator, 5)).toFixed(2)} PB`;
}

function formatTime(time) {
  if (time <= 0) return 'Unknown';
  let sec, min, hour;
  if (time < 60) sec = time;
  else if (time < 60 * 60) {
    min = Math.floor(time / 60);
    sec = time - min * 60;
  }
  else {
    hour = Math.floor(time / (60 * 60));
    min = Math.floor((time - hour * 60 * 60) / 60);
    sec = time - hour * 60 * 60 - min * 60;
  }
  return `${hour ? `${hour}h` : ''}${min ? `${min}m` : ''}${sec ? `${sec}s` : ''}`;
}

(async () => {
  let timeout = false, finished = false;
  const timeoutFlag = setTimeout(() => timeout = true, 5.5 * 60 * 60 * 1000);
  try {
    while (!timeout && !finished) {
      const { body } = await client.post('http://localhost:9091/transmission/rpc', {
        json: {
          method: 'torrent-get',
          arguments: {
            fields: [
              'id',
              'eta',
              'leftUntilDone',
              'percentDone',
              'rateDownload',
              'sizeWhenDone',
              'status',
              'error',
              'errorString'
            ],
            ids: [Number(id)]
          }
        }
      });
      const torrent = body.arguments.torrents[0];
      if (!torrent) {
        finished = true;
        break;
      }
      const { eta, rateDownload, percentDone, leftUntilDone, sizeWhenDone, status, error, errorString } = torrent;
      console.log(`${formatSize(sizeWhenDone - leftUntilDone)} / ${formatSize(sizeWhenDone)} (${(percentDone * 100).toFixed(2)}%)  Speed: ${formatSize(rateDownload, 1000)}/s  Remaining: ${formatTime(eta)}  Status: ${status} Error: ${error} ${errorString}`);
      if (percentDone === 1) finished = true;
      await new Promise(res => setTimeout(() => res(), 30 * 1000));
    }
    clearTimeout(timeoutFlag);
  }
  catch (error) {
    console.log(error);
    if (error.response && error.response.body) console.log(error.response.body);
    clearTimeout(timeoutFlag);
    process.exit(1);
  }
})();