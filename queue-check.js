const request = require('request');
const fs = require('fs');
const got = require('got');

const [, , repository, token, action_name, dispatchType] = process.argv;

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

async function saveQueue(filename, queue) {
  let content = Buffer.from(queue).toString('base64'),
    timeStamp = Date.now(),
    commitLink = `https://api.github.com/repos/${repository}/commits`,
    configLink = `https://api.github.com/repos/${repository}/contents/${filename}`,
    body = {
      message: `更新于${new Date(timeStamp).toLocaleString()}`,
      content
    },
    headers = {
      'Authorization': `token ${token}`,
      'User-Agent': 'Github Actions'
    };
  const response = await new Promise((res, rej) => {
    request(commitLink, {
      headers,
      timeout: 10000
    }, function (error, response) {
      if (error) return rej(error);
      else res(response);
    });
  });
  tree_sha = JSON.parse(response.body)[0].commit.tree.sha;

  const treeResponse = await new Promise((res, rej) => {
    request(`https://api.github.com/repos/${repository}/git/trees/${tree_sha}`, {
      headers,
      timeout: 10000
    }, function (error, response) {
      if (error) return rej(error);
      else res(response);
    });
  });
  const file = JSON.parse(treeResponse.body).tree.find(file => file.path === filename);
  body.sha = file.sha;
  await new Promise((res, rej) => {
    request(configLink, {
      method: 'PUT',
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
      body: JSON.stringify(body),
      timeout: 10000
    }, function (error, response) {
      if (error) return rej(error);
      else res(response);
    });
  });
}

async function workflowCheck() {
  let in_progress_count = 0;
  for (const workflow of workflows) {
    const workflow_link = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}.yml/runs`;
    const { body } = await got(workflow_link, {
      searchParams: {
        per_page: 20,
        status: 'in_progress'
      },
      headers: {
        'User-Agent': 'Github Actions'
      },
      timeout: 10000,
      responseType: 'json'
    });
    if (typeof body.total_count === 'number') in_progress_count += body.total_count;
  }
  return in_progress_count;
}

async function addToQueue() {
  const queue = JSON.parse(fs.readFileSync('queue.json')) || [];
  const list = fs.readFileSync(list_name[action_name]);
  queue.push({
    name: action_name,
    inputs: { list }
  });
  await saveQueue('queue.json', JSON.stringify(queue, null, 2));
}

(async () => {
  try {
    if (dispatchType === 'queue-execute') {
      console.log('队列触发任务');
      console.log('');
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