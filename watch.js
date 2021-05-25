const got = require('got');

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

function formatSize(size, denominator = 1024) {
  if (size < denominator) return `${size} B`;
  else if (size < Math.pow(denominator, 2)) return `${size / denominator} KB`;
  else if (size < Math.pow(denominator, 3)) return `${size / Math.pow(denominator, 2)} MB`;
  else if (size < Math.pow(denominator, 4)) return `${size / Math.pow(denominator, 3)} GB`;
  else if (size < Math.pow(denominator, 5)) return `${size / Math.pow(denominator, 4)} TB`;
  else if (size < Math.pow(denominator, 6)) return `${size / Math.pow(denominator, 5)} PB`;
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
  try {
    let timeout = false, finished = false;
    setTimeout(() => timeout = true, 5.5 * 60 * 60 * 1000);
    while (timeout || finished) {
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
              'sizeWhenDone'
            ],
            ids: 'recently-active'
          }
        }
      });
      const torrent = body.arguments.torrents[0];
      if (!torrent) {
        finished = true;
        continue;
      }
      const { eta, rateDownload, percentDone, leftUntilDone, sizeWhenDone } = torrent;
      console.log(`${formatSize(sizeWhenDone - leftUntilDone)} / ${formatSize(sizeWhenDone)} (${percentDone * 100}%)  Speed: ${formatSize(rateDownload, 1000)}/s  Remaining: ${formatTime(eta)}`);
      if (percentDone === 1) finished = true;
      await new Promise(res => setTimeout(() => res(), 30 * 1000));
    }
  }
  catch (error) {
    console.log(error);
    if (error.response && error.response.body) console.log(error.response.body);
    process.exit(1);
  }
})();