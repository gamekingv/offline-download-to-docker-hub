const got = require('got');

const [, , repository, token, dispatchToken] = process.argv;

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
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: JSON.stringify(body)
  });
}

async function getQueue() {
  const { body: queue } = await client.get(`https://raw.githubusercontent.com/${repository}/main/queue.json`);
  return queue;
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
      const task = queue.pop();
      await executeTask(task);
      await saveQueue('queue.json', JSON.stringify(queue, null, 2));
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