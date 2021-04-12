const axios = require('axios');
const fs = require('fs');

(async () => {
  try {
    const { data } = await axios.get('https://ngosang.github.io/trackerslist/trackers_best.txt', { timeout: 10000 });
    // const { data } = await axios.get('https://cdn.jsdelivr.net/gh/ngosang/trackerslist/trackers_best.txt', { timeout: 10000 });
    fs.appendFile('aria2.conf',
      `\nbt-tracker=${data.split('\n').filter(s => s && s.trim()).join(',')}\n`,
      'utf-8',
      err => { if (err) throw err; }
    );
    console.log('获取tracker成功');
    console.log('');
  }
  catch (e) {
    console.log(e.toString());
  }
})();