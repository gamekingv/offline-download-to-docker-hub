const fs = require('fs');
const got = require('got');
const MongoClient = require('mongodb').MongoClient;

const {
  GITHUB_REPOSITORY: repository,
  QUEUE_TOKEN: token,
  GITHUB_WORKFLOW: workflow_name,
  GITHUB_RUN_ID: run_id,
  QUEUE_DB_HOST: db_host,
  QUEUE_DB_USERNAME: db_username,
  QUEUE_DB_PASSWORD: db_password,
  GITHUB_EVENT_PATH
} = process.env;
const event = JSON.parse(fs.readFileSync(GITHUB_EVENT_PATH));
const dispatch_type = event.inputs.type;
const parent_run_id = event.inputs.parent;
const list_content = event.inputs.list;
const db_name = 'github_action';
const collection_name = 'queue';
const uri = `mongodb+srv://${db_username}:${db_password}@${db_host}/${db_name}?retryWrites=true&w=majority`;



const list_name = {
  'baidu-download': 'baidu-list.txt',
  'decompression-download': 'decompression-list.txt',
  'offline-download': 'list.txt',
  'subtitle-download': 'subtitles.json'
};

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
//     headers,
//     body: JSON.stringify(body)
//   });
// }

async function workflowCheck() {
  const workflow_link = `https://api.github.com/repos/${repository}/actions/runs`;
  const { body } = await client.get(workflow_link, {
    searchParams: {
      per_page: 20,
      status: 'in_progress'
    }
  });
  return body.workflow_runs.filter(run => run.id !== parent_run_id).every(run => run.id >= run_id);
}

async function addToQueue() {
  // const queue = JSON.parse(fs.readFileSync('queue.json')) || [];
  let list = '';
  if (list_name[workflow_name]) list = fs.readFileSync(list_name[workflow_name]).toString();
  // queue.push({
  //   name: workflow_name,
  //   list
  // });
  // await saveQueue('queue.json', JSON.stringify(queue, null, 2));
  const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  const collection = client.db(db_name).collection(collection_name);
  await collection.insertOne({ name: workflow_name, list });
  await client.close();
}

async function cancelWorkflow() {
  await client.post(`https://api.github.com/repos/${repository}/actions/runs/${run_id}/cancel`, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${token}`
    }
  });
}

(async () => {
  try {
    if (dispatch_type === 'queue-execute') {
      console.log('队列触发任务');
      if (list_name[workflow_name]) fs.writeFileSync(list_name[workflow_name], list_content);
    }
    const idle = await workflowCheck();
    if (idle) console.log('正常进行任务');
    else {
      await addToQueue();
      console.log('有任务正在进行，保存到任务队列');
      await cancelWorkflow();
      await new Promise(res => setTimeout(() => res(), 60000));
    }

  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
})();
