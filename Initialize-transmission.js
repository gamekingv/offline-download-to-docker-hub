const fs = require('fs').promises;

(async () => {
  try {
    const settings = JSON.parse(await fs.readFile('/etc/transmission-daemon/settings.json'));
    Object.assign(settings, {
      'download-dir': `${__dirname}/Offline`,
      'rpc-authentication-required': 0
    });
    await fs.writeFile('/etc/transmission-daemon/settings.json', JSON.stringify(settings, null, 2));
    const initial = (await fs.readFile('/etc/init.d/transmission-daemon')).toString();
    await fs.writeFile('/etc/init.d/transmission-daemon', initial.replace('debian-transmission', 'root'));
  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
})();