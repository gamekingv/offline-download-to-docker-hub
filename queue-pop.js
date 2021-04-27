// const fs = require('fs');
const got = require('got');
const MongoClient = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;

const {
  GITHUB_REPOSITORY: repository,
  // QUEUE_TOKEN: token,
  QUEUE_DISPATCH_TOKEN: dispatchToken,
  QUEUE_DB_HOST: db_host,
  QUEUE_DB_USERNAME: db_username,
  QUEUE_DB_PASSWORD: db_password
} = process.env;

const db_name = 'github_action';
const collection_name = 'queue';
const uri = `mongodb+srv://${db_username}:${db_password}@${db_host}/${db_name}?retryWrites=true&w=majority`;

const client = got.extend({
  headers: {
    'User-Agent': 'Github Actions'
  },
  timeout: 10000,
  responseType: 'json'
});

// async function saveQueue(filename, queue) {
//   const content = Buffer.from(queue).toString('base64');
//   const timeStamp = Date.now();
//   const commitLink = `https://api.github.com/repos/${repository}/commits`;
//   const configLink = `https://api.github.com/repos/${repository}/contents/${filename}`;
//   const body = {
//     message: `更新于${new Date(timeStamp).toLocaleString()}`,
//     content
//   };
//   const headers = {
//     'Authorization': `token ${token}`
//   };

//   const response = await client.get(commitLink, {
//     headers
//   });

//   tree_sha = response.body[0].commit.tree.sha;

//   const treeResponse = await client.get(
//     `https://api.github.com/repos/${repository}/git/trees/${tree_sha}`, {
//     headers
//   });

//   const file = treeResponse.body.tree.find(file => file.path === filename);
//   body.sha = file.sha;

//   await client.put(configLink, {
//     headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
//     body: JSON.stringify(body)
//   });
// }

async function getQueue() {
  // const queue = JSON.parse(fs.readFileSync('latest/queue.json'));
  // return queue;
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  const collection = client.db(db_name).collection(collection_name);
  const result = await collection.find({}).toArray();
  await client.close();
  return result;
}

async function executeTask({ name, list }) {
  const body = JSON.stringify({
    ref: 'main',
    inputs: {
      type: 'queue-execute',
      list
    }
  });
  await client.post(`https://api.github.com/repos/${repository}/actions/workflows/${name}.yml/dispatches`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${dispatchToken}`
    },
    body,
  });
}

(async () => {
  try {
    const queue = await getQueue();
    if (queue && queue.length > 0) {
      const task = queue.shift();
      await executeTask(task);
      const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
      await client.connect();
      const collection = client.db(db_name).collection(collection_name);
      await collection.deleteOne({ _id: new ObjectID(task._id) });
      await client.close();
      // await saveQueue('queue.json', JSON.stringify(queue, null, 2));
      console.log('已触发下一个队列任务');
      console.log(`任务类型：${task.name}`);
      if (task.list) console.log(`列表：${task.list}`);
    }
    else console.log('队列中已无任务');
  }
  catch (error) {
    console.log(error);
  }
})();
