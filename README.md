<h1 align="center">offline-download-to-docker-hub</h1>

> 离线下载各种资源并上传到Docker网盘，需要先在secrets中添加URL、USERNAME、PASSWORD变量，所有资源默认上传到/Offline目录下。

> 每个下载任务最多只能运行6小时，超过会自动被终止。

> 任务会串行下载，如新任务执行时检测到已有任务在进行，将会终止，并写入queue.json文件中进入队列，在进行中任务完成时，会自动触发队列中的任务执行。

## 百度网盘
在baidu-list.txt添加网盘文件路径即可，例如/folder/files.mp4，也可以是目录。需要先在secrets中添加BDUSS。

## 解压下载
在decompression-list.txt添加下载链接即可，可以是Aria2支持的所有下载链接，下载后会自动解压所有rar、zip压缩包，之后再上传。支持exhentai的种子链接，需要先在secrets中添加EX_COOKIES。

## 普通离线下载
在list.txt添加下载链接即可，可以是Aria2支持的所有下载链接，下载完成后会自动上传。
