const fs = require('fs');
const got = require('got');

const [, , repository, token, action_name, dispatch_type, list_content] = process.argv;

const workflows = [
  'baidu-download',
  'decompression-donwload',
  'offline-download'
];
const list_name = {
  'baidu-download': 'baidu-list.txt',
  'decompression-donwload': 'decompression-list.txt',
  'offline-download': 'list.txt'
};

const client = got.extend({
  headers: {
    'User-Agent': 'Github Actions'
  },
  timeout: 10000,
  responseType: 'json'
});

async function saveQueue(filename, queue) {
  const content = Buffer.from(queue).toString('base64');
  const timeStamp = Date.now();
  const commitLink = `https://api.github.com/repos/${repository}/commits`;
  const configLink = `https://api.github.com/repos/${repository}/contents/${filename}`;
  const body = {
    message: `更新于${new Date(timeStamp).toLocaleString()}`,
    content
  };
  const headers = {
    'Authorization': `token ${token}`
  };

  const response = await client.get(commitLink, {
    headers
  });

  tree_sha = response.body[0].commit.tree.sha;

  const treeResponse = await client.get(
    `https://api.github.com/repos/${repository}/git/trees/${tree_sha}`, {
    headers
  });

  const file = treeResponse.body.tree.find(file => file.path === filename);
  body.sha = file.sha;

  await client.put(configLink, {
    headers,
    body: JSON.stringify(body)
  });
}

async function workflowCheck() {
  let in_progress_count = 0;
  for (const workflow of workflows) {
    const workflow_link = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}.yml/runs`;
    const { body } = await client.get(workflow_link, {
      searchParams: {
        per_page: 20,
        status: 'in_progress'
      }
    });
    if (typeof body.total_count === 'number') in_progress_count += body.total_count;
  }
  return in_progress_count;
}

async function addToQueue() {
  const queue = JSON.parse(fs.readFileSync('queue.json')) || [];
  const list = fs.readFileSync(list_name[action_name]).toString();
  queue.push({
    name: action_name,
    inputs: { list }
  });
  await saveQueue('queue.json', JSON.stringify(queue, null, 2));
}

(async () => {
  try {
    if (dispatch_type === 'queue-execute') {
      console.log('队列触发任务');
      console.log('');
      fs.writeFileSync(list_name[action_name], list_content);
    }
    else {
      const in_progress_count = await workflowCheck();
      if (in_progress_count > 0) {
        await addToQueue();
        process.exit(1);
      }
    }
  }
  catch (error) {
    console.log(error);
  }
})();