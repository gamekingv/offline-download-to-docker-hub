const MongoClient = require('mongodb').MongoClient;
const axios = require('axios');
const crypto = require('crypto');

const {
  QUEUE_DD_URL: repositoryUrl,
  QUEUE_DD_USERNAME: username,
  QUEUE_DD_PASSWORD: password,
  QUEUE_DB_HOST: db_host,
  QUEUE_DB_USERNAME: db_username,
  QUEUE_DB_PASSWORD: db_password
} = process.env;

const [server, namespace, image] = repositoryUrl.split('/');
const secret = new Buffer.from(`${username}:${password}`).toString('base64');
const repository = {
  token: '',
  secret,
  server,
  namespace,
  image
};

const db_name = 'docker_drive';
const uri = `mongodb+srv://${db_username}:${db_password}@${db_host}/${db_name}?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
const collection_name = repositoryUrl;
let collection;


const preset = {
  retry: 3,
  timeout: 10000
};

async function errorHandler(error) {
  const config = error.config;
  if (error.response) {
    if (!config || [401, 404, 504].some(status => error.response.status === status)) return await Promise.reject(error);
    console.log('请求出错，HTTP状态码：' + error.response.status);
  }
  else console.log(`请求出错：${error.toString()}`);
  config.__retryCount = config.__retryCount || 0;
  if (config.__retryCount >= preset.retry) return await Promise.reject(error);
  config.__retryCount += 1;
  await new Promise(res => setTimeout(() => res(''), 1000));
  console.log(`第 ${config.__retryCount} 次重试请求`);
  return await axios(config);
}

axios.defaults.timeout = preset.timeout;
axios.interceptors.response.use(undefined, errorHandler);
axios.defaults.maxContentLength = Infinity;
axios.defaults.maxBodyLength = Infinity;

async function requestSender(url, instance) {
  instance.interceptors.response.use(undefined, errorHandler);
  if (repository.token) instance.defaults.headers.common['Authorization'] = `Bearer ${repository.token}`;
  try {
    return await instance.request({ url });
  }
  catch (error) {
    if (!error.response) throw error;
    const { status, headers } = error.response;
    if (status === 401) {
      try {
        const token = await getToken(headers['www-authenticate']);
        if (token) {
          repository.token = token;
          instance.defaults.headers.common['Authorization'] = `Bearer ${repository.token}`;
        }
        else throw '获取token失败';
        return await instance.request({ url });
      }
      catch (error) {
        if (!error.response) throw error;
        const { status } = error.response;
        if (status === 401) throw '账号或密码错误';
        else throw error;
      }
    }
    throw error;
  }
}

async function getToken(authenticateHeader) {
  if (!authenticateHeader) throw '获取token失败';
  const [, realm, service, , scope] = authenticateHeader.match(/^Bearer realm="([^"]*)",service="([^"]*)"(,scope="([^"]*)"|)/);
  if (realm && service) {
    let authenticateURL = `${realm}?service=${service}`;
    if (scope) authenticateURL += `&scope=${scope}`;
    const headers = {};
    if (repository.secret) headers['Authorization'] = `Basic ${repository.secret}`;
    const { data } = await axios.get(authenticateURL, { headers, timeout: 5000 });
    return data.token;
  }
  else throw '获取token失败';
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
  else throw '获取上传链接失败';
}

async function uploadConfig(config) {
  const { server, namespace, image } = repository;
  const size = config.length;
  const hash = crypto.createHash('sha256').update(config);
  const digest = `sha256:${hash.digest('hex').toString()}`;
  const url = await getUploadURL();
  const instance = axios.create({
    method: 'put',
    headers: {
      'Content-Type': 'application/octet-stream',
      'repository': [server, namespace, image].join('/'),
      'Content-Length': size
    },
    timeout: 0
  });
  instance.interceptors.request.use(e => Object.assign(e, {
    data: Buffer.from(config, 'utf8')
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

async function getManifests() {
  const { server, namespace, image } = repository;
  const manifestsURL = `https://${server}/v2/${namespace}/${image}/manifests/latest`;
  const manifestsInstance = axios.create({
    method: 'get',
    headers: {
      'Accept': 'application/vnd.docker.distribution.manifest.v2+json',
      'repository': [server, namespace, image].join('/')
    }
  });
  try {
    const { data } = await requestSender(manifestsURL, manifestsInstance);
    const layers = data.layers;
    const digest = data.config.digest;
    if (digest && layers) {
      const configURL = `https://${server}/v2/${namespace}/${image}/blobs/${digest}`;
      const configInstance = axios.create({
        method: 'get',
        headers: {
          'repository': [server, namespace, image].join('/')
        }
      });
      const { data } = await requestSender(configURL, configInstance);
      if (data) return { config: data, layers };
      else throw '加载配置文件失败';
    }
    else throw '加载配置文件失败';
  }
  catch (error) {
    if (error.response) {
      const { status } = error.response;
      if (status === 404) return { config: { files: [] }, layers: [] };
    }
    throw error;
  }
}

function parse(array) {
  const mark = {};
  const root = [];
  array.forEach(item => {
    mark[item._id] = item;
    item.id = Symbol();
    if (item.type === 'folder') item.files = [];
  });
  array.forEach(item => {
    if (item.parent === null) root.push(item);
    else mark[item.parent].files.push(item);
    delete item.parent;
  });
  const files = new Set();
  array.forEach(item => item.type === 'file' ? files.add(`${item.digest}|${item.size}`) : '');
  const layers = Array.from(files).map(file => {
    const [digest, size] = file.split('|');
    return {
      mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
      digest, size: Number(size)
    };
  });
  return { files: root, layers };
}

async function treeToArray(items, parent) {
  for (const item of items) {
    const files = item.files;
    delete item.files;
    delete item._id;
    item.parent = parent;
    const { insertedId: id } = await collection.insertOne(item);
    if (files) await treeToArray(files, id);
  }
}

async function initialize(files) {
  await collection.deleteMany();
  if (files) await treeToArray(files, null);
  await collection.createIndex({ name: 1, parent: 1 }, { unique: true });
}


(async () => {
  try {
    await client.connect();
    console.log('获取docker配置');
    const { config } = await getManifests();
    collection = client.db(db_name).collection(collection_name);
    console.log('同步docker配置到数据库');
    await initialize(config.files);
    console.log('获取数据库配置');
    const array = await collection.find().toArray();
    console.log('同步数据库配置到docker');
    const newConfig = parse(array);
    await commit(newConfig);
    console.log('同步完成');
  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
  await client.close();
})();
