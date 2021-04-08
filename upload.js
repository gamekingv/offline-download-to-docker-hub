const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

const [, , repositoryUrl, username, password] = process.argv;

const [server, namespace, image] = repositoryUrl.split('/');
const secret = new Buffer.from(`${username}:${password}`).toString('base64');
const repository = {
  token: '',
  secret,
  server,
  namespace,
  image
};

async function requestSender(url, instance) {
  if (repository.token) instance.defaults.headers.common['Authorization'] = `Bearer ${repository.token}`;
  try {
    return await instance.request({ url });
  }
  catch (error) {
    const { status, headers } = error.response;
    if (status === 401) {
      try {
        const token = await getToken(headers['www-authenticate']);
        if (token) {
          repository.token = token;
          instance.defaults.headers.common['Authorization'] = `Bearer ${repository.token}`;
        }
        else throw 'getTokenFailed';
        return await instance.request({ url });
      }
      catch (error) {
        const { status, headers } = error.response;
        if (status === 401) throw { message: 'need login', authenticateHeader: headers['www-authenticate'] };
        else throw error;
      }
    }
    throw error;
  }
}

async function getToken(authenticateHeader) {
  if (!authenticateHeader) throw 'getTokenFailed';
  const [, realm, service, , scope] = authenticateHeader.match(/^Bearer realm="([^"]*)",service="([^"]*)"(,scope="([^"]*)"|)/);
  if (realm && service) {
    let authenticateURL = `${realm}?service=${service}`;
    if (scope) authenticateURL += `&scope=${scope}`;
    const headers = {};
    if (repository.secret) headers['Authorization'] = `Basic ${repository.secret}`;
    const { data } = await axios.get(authenticateURL, { headers, timeout: 5000 });
    return data.token;
  }
  else throw 'getTokenFailed';
}

async function getUploadURL() {
  const { server, namespace, image } = repository;
  const instance = axios.create({
    method: 'post',
    headers: {
      'repository': [server, namespace, image].join('/')
    }
  });
  const url = `https://${server}/v2/${namespace}/${image}/blobs/uploads/`;
  const { headers } = await requestSender(url, instance);
  if (headers['location']) return headers['location'];
  else throw 'getUploadURLFailed';
}

async function uploadConfig(config) {
  const { server, namespace, image } = repository;
  const size = config.length;
  const digest = `sha256:${CryptoJS.SHA256(config)}`;
  const url = await getUploadURL();
  const instance = axios.create({
    method: 'put',
    headers: {
      'Content-Type': 'application/octet-stream',
      'repository': [server, namespace, image].join('/'),
      'Content-Size': size
    },
    timeout: 0
  });
  instance.interceptors.request.use(e => Object.assign(e, {
    data: new Blob([config], { type: 'application/octet-stream' })
  }));
  await requestSender(`${url}&digest=${digest}`, instance);
  return { digest, size };
}

async function uploadFile(path) {
  const { server, namespace, image } = repository;
  const size = fs.statSync(path).size;
  const digest = await hashFile(path);
  const url = await getUploadURL();
  const instance = axios.create({
    method: 'put',
    headers: {
      'Content-Type': 'application/octet-stream',
      'repository': [server, namespace, image].join('/'),
      'Content-Size': size
    },
    timeout: 0
  });
  instance.interceptors.request.use(e => Object.assign(e, {
    data: fs.createReadStream(path)
  }));
  await requestSender(`${url}&digest=${digest}`, instance);
  return { digest, size };
}

async function commit(config) {
  const { server, namespace, image } = repository;
  const { digest, size } = await uploadConfig(JSON.stringify({ files: config.files }));
  const manifest = {
    schemaVersion: 2,
    mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    config: {
      mediaType: 'application/vnd.docker.container.image.v1+json',
      size,
      digest
    },
    layers: config.layers
  };
  const url = `https://${server}/v2/${namespace}/${image}/manifests/latest`;
  const instance = axios.create({
    method: 'put',
    headers: {
      'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json',
      'repository': [server, namespace, image].join('/')
    },
  });
  instance.interceptors.request.use(e => Object.assign(e, {
    data: JSON.stringify(manifest)
  }));
  await requestSender(url, instance);
}

function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const rs = fs.createReadStream(path);
    rs.on('error', reject);
    rs.on('data', chunk => hash.update(chunk));
    rs.on('end', () => resolve(hash.digest('hex')));
  });
}
