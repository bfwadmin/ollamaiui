const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { exec, spawn } = require('child_process');
const httpProxy = require('http-proxy');
const os = require('os');
const qrcode = require('qrcode');
const axios = require('axios');
const { setTimeout } = require('timers');


function isProcessRunning(processName, callback) {
  const platform = process.platform;

  let cmd = '';

  if (platform === 'win32') {
    // Windows 命令
    cmd = `tasklist`;
  } else if (platform === 'darwin' || platform === 'linux') {
    // macOS 和 Linux 命令
    cmd = `ps -A`;
  } else {
    callback(new Error(`Unsupported platform: ${platform}`));
    return;
  }

  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      callback(err);
      return;
    }

    const processList = stdout.toLowerCase();
    const isRunning = processList.includes(processName.toLowerCase());

    callback(null, isRunning);
  });
}

function openBrowser(url) {

  const platform = process.platform;


  let cmd = '';

  if (platform === 'win32') {
    // Windows 命令
    cmd = `start`;
  } else if (platform === 'darwin') {
    // macOS 和 Linux 命令
    cmd = `open `;
  }
  if (cmd != "") {
    exec(cmd + `  ${url}`, (error, stdout, stderr) => { });
  }


}


// 使用示例
const processName = 'ollama'; // 要检测的进程名
const startCommand = 'ollama list'; // 启动进程的命令
const failureUrl = 'https://ollama.com'; // 启动失败时打开的 URL

isProcessRunning(processName, (err, isRunning) => {
  if (err) {
    console.error('Error:', err);
    return;
  }

  if (isRunning) {
    console.log(`${processName} is already running.`);
    startServer();


  } else {
    console.log(`${processName} is not running. Starting it now...`);
    // const cmdexec = spawn('ollama', ['list']);

    // cmdexec.stdout.on('data', (data) => {
    //   console.log(`stdout: ${data}`);
    //   startServer();
    // });

    // cmdexec.stderr.on('data', (data) => {
    //   console.error(`stderr: ${data}`);
    // });

    // cmdexec.on('close', (code) => {
    //   console.log(`child process exited with code ${code}`);
    //   openBrowser(failureUrl);
    // });
    let isrunerr = false;
    exec(startCommand, (error, stdout, stderr) => {
      if (error) {
        isrunerr = true;
        console.error(`exec error: ${error}`);
        openBrowser(failureUrl);
        return;
      }

      console.log(`stdout: ${stdout}`);
      console.error(`stderr: ${stderr}`);
    });

    setTimeout(function () {
      if (!isrunerr) {
        startServer();
      } else {
        console.log(`未检测到ollama运行，请先下载后运行`);
      }
    }, 3000);

  }

});

// 创建反向代理服务器
const proxy = httpProxy.createProxyServer({ ws: true });
// 修改请求头中的 Host 字段
proxy.on('proxyReq', (proxyReq, req, res, options) => {
  //proxyReq.setHeader('Host', 'localhost:11434');

});
// 获取资源的路径
function getAssetPath(assetName) {
  if (process.pkg) {
    // 如果在开发环境中运行
    return path.join(__dirname, assetName);
  } else {

    // 如果在打包环境中运行
    return path.join(process.cwd(), "/dist/" + assetName);
  }
}

// 获取局域网 IP 地址
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// 生成二维码
function generateQrCode(text) {
  return new Promise((resolve, reject) => {
    qrcode.toString(text, { type: 'terminal' }, (err, url) => {
      if (err) {
        reject(err);
      } else {
        resolve(url);
      }
    });
  });
}
function getBodyText(html) {
  // 使用正则表达式匹配<body>标签内的内容
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch && bodyMatch[1]) {
    // 去除HTML标签，只保留文本内容
    return bodyMatch[1].replace(/<[^>]+>/g, '');
  }
  return '';
}

// 处理 POST 请求的 JSON 数据
function handlePostRequest(req, res) {
  let body = '';

  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    try {
      const jsonData = JSON.parse(body);

      const act = jsonData.action; // 使用专门的字段表示操作类型

      if (act === "getpagebyurl") {
        const targetUrl = jsonData.url;
        if (!targetUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'URL is required' }));
          return;
        }
        console.log(targetUrl);

        // 使用 axios 抓取目标 URL 的内容，并设置超时时间为 10 秒
        axios.get(targetUrl, { timeout: 10000 })
          .then(response => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ content: getBodyText(response.data) }));
          })
          .catch(error => {
            console.error('Axios error:', error);
            let errorMessage = 'Failed to fetch URL';
            if (error.response) {
              errorMessage = `Server responded with status ${error.response.status}`;
            } else if (error.request) {
              errorMessage = 'No response received from server';
            } else {
              errorMessage = error.message;
            }
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: errorMessage }));
          });
      } else {
        // 处理未知的操作类型
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown action' }));
      }
    } catch (error) {
      console.error('Error in handlePostRequest:', error);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request' }));
    }
  });
}
function startServer() {
  const server = http.createServer((req, res) => {
    const pathname = url.parse(req.url).pathname;

    if (pathname === '/webapi/' && req.method === 'POST') {
      handlePostRequest(req, res);
    } else if (pathname.startsWith('/api/')) {

      // 反向代理配置
      const target = 'http://127.0.0.1:11434'; // 目标服务器地址

      // Proxy the request
      proxy.web(req, res, { target }, (proxyErr) => {
        if (proxyErr) {
          console.error('Failed to proxy request:', proxyErr);
          console.error('Failed to proxy request:', req.headers);
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway');
        }
      });

    } else {


      const filepath = getAssetPath(pathname);


      fs.access(filepath, fs.constants.R_OK, (err) => {
        if (err) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not Found');
          return;
        }

        const extname = path.extname(filepath);
        let contentType = 'text/plain';

        switch (extname) {
          case '.html':
            contentType = 'text/html';
            break;
          case '.js':
            contentType = 'text/javascript';
            break;
          case '.css':
            contentType = 'text/css';
            break;
          case '.json':
            contentType = 'application/json';
            break;
          case '.png':
            contentType = 'image/png';
            break;
          case '.jpg':
          case '.jpeg':
            contentType = 'image/jpeg';
            break;
          case '.gif':
            contentType = 'image/gif';
            break;
          case '.svg':
            contentType = 'image/svg+xml';
            break;
          case '.wav':
            contentType = 'audio/wav';
            break;
        }

        fs.readFile(filepath, (err, content) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
          } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
          }
        });
      });
    }
  });



  const PORT = process.env.PORT || 12314;
  server.listen(PORT, '0.0.0.0', async () => {
    console.log(`服务启动，端口为 ${PORT}`);
    const localIp = getLocalIp();
    const serverUrl = `http://${localIp}:${PORT}`;
    console.log(`本地地址: http://localhost:${PORT}/index.html`);
    console.log(`局域网地址: http://${localIp}:${PORT}/index.html`);
    const qrCode = await generateQrCode(serverUrl);
    console.log(`手机等其他设备可扫码体验（必须与电脑在同一个局域网）:\n${qrCode}`);
    // 自动打开浏览器
    openBrowser(`http://localhost:${PORT}/index.html`);
  });
}
// setTimeout(function(){
//   if(isollamarun){
//     startServer();
//   }else{
//     console.log(`未检测到ollama运行，请先下载后运行`);
//   }
// },2000);
