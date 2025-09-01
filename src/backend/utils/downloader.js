const { spawn } = require("child_process");
const { logger } = require("./AppLogger");
const ffmpeg = require("ffmpeg-static");
const iso6391 = require("iso-639-1");
const path = require("path");
const got = require("got");
const fs = require("fs");
const MTDownloader = require("mt-downloader");

const ffmpegPath = ffmpeg.replace("app.asar", "app.asar.unpacked");

class downloader {
  constructor({
    directory,
    streamUrl,
    Epnum = NaN,
    caption,
    EpID,
    subtitles = [],
    MergeSubtitles = false,
    ChangeTosrt = false,
    threads = 4,
  }) {
    this.directory = directory;
    if (streamUrl?.url) {
      this.streamUrl = streamUrl.url;
      this.headers = streamUrl.headers ?? {};
    } else {
      this.streamUrl = streamUrl;
    }
    this.Epnum = parseInt(Epnum);
    this.caption = caption;
    this.EpID = EpID;
    this.threads = Math.max(1, Math.min(10, parseInt(threads) || 4));
    this.subtitles =
      subtitles?.length > 0
        ? subtitles?.filter(({ lang }) => lang !== "Thumbnails") ?? []
        : [];
    this.MergeSubtitles = MergeSubtitles ?? false;
    this.ChangeTosrt = ChangeTosrt ?? false;
    this.downloadedPaths = [];
    this.isPaused = false;
    this.speed = 0;
    this.startTime = Date.now();
    this.downloadedBytes = 0;
    this.lastSpeedUpdate = Date.now();
    this.lastDownloadedBytes = 0;
  }

  // Additional Checks
  async DownloadsChecking() {
    if (
      !this.directory ||
      !(await this.CheckFileFolderExists(this.directory))
    ) {
      throw new Error("Directory Not Found!");
    }

    if (!this.Epnum) {
      throw new Error("No Episode Number Found!");
    }

    if (!this.EpID || this.EpID.length <= 0) {
      throw new Error("No Ep id found!");
    }

    this.mp4 = path.join(this.directory, `${this.Epnum}Ep.mp4`);
    this.SegmentsFile = path.join(this.directory, `${this.Epnum}Ep.ts`);

    if (!this.streamUrl || this.streamUrl.length <= 0) {
      throw new Error("No Stream Url Provided");
    } else {
      let Playlist = await got(this.streamUrl, {
        headers: this.headers ?? {},
      }).text();

      if (!Playlist) throw new Error("No Stream Found!");
      let Segments = Playlist.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("https://"));

      if (Segments.length <= 0) throw new Error("No Segments Found!");

      this.Segments = Segments;
      this.totalSegments = Segments.length;
      this.currentSegments = 0;

      if (this.subtitles && this.subtitles.length > 0) {
        this.totalSegments += this.subtitles.length;
      }

      this.logProgress();
    }
  }

  async CheckFileFolderExists(FileDir) {
    if (!FileDir) return false;
    try {
      await fs.promises.access(FileDir);
      return true;
    } catch (err) {
      return false;
    }
  }

  async DownloadStart() {
    try {
      this.SegmentsFile = path.join(this.directory, `${this.Epnum}Ep.ts`);
      this.metadataFile = path.join(this.directory, `${this.Epnum}Ep.mtd`);
      
      // Check if resumable download exists
      let resumable = false;
      if (fs.existsSync(this.metadataFile)) {
        try {
          const metadata = JSON.parse(fs.readFileSync(this.metadataFile, 'utf8'));
          if (metadata.url === this.streamUrl && metadata.segmentsCount === this.Segments.length) {
            resumable = true;
            this.currentSegments = metadata.downloadedSegments || 0;
            logger.info(`Resuming download from segment ${this.currentSegments}`);
          }
        } catch (err) {
          logger.error('Failed to read resume metadata:', err.message);
        }
      }

      // Save metadata for resume capability
      const metadata = {
        url: this.streamUrl,
        segmentsCount: this.Segments.length,
        downloadedSegments: this.currentSegments,
        epid: this.EpID,
        title: this.caption
      };
      fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2));

      this.writer = fs.createWriteStream(this.SegmentsFile, {
        flags: resumable ? "a" : "w",
        encoding: null,
      });
      
      this.writer.on("error", (err) => {
        throw err;
      });

      // Download segments with multi-threading
      await this.downloadSegmentsConcurrently();

      await new Promise((resolve) => {
        this.writer.end(resolve);
      });

      // Clean up metadata file on successful completion
      if (fs.existsSync(this.metadataFile)) {
        fs.unlinkSync(this.metadataFile);
      }
    } catch (err) {
      throw new Error(err);
    }
  }

  async downloadSegmentsConcurrently() {
    const segmentsToDownload = this.Segments.slice(this.currentSegments);
    const maxConcurrent = Math.min(this.threads, segmentsToDownload.length);
    
    // Use a semaphore approach for concurrent downloads while maintaining order
    let totalDownloadedBytes = 0;
    const startTime = Date.now();
    let downloadedSegments = new Array(segmentsToDownload.length);
    let activeTasks = 0;
    let currentWriteIndex = 0;
    
    // Initialize speed tracking
    this.speed = 0;
    
    return new Promise((resolve, reject) => {
      const processSegment = async (index) => {
        if (index >= segmentsToDownload.length) {
          return;
        }
        
        activeTasks++;
        const segment = segmentsToDownload[index];
        
        try {
          // Check for pause
          while (this.isPaused) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          const segmentStartTime = Date.now();
          const segmentData = await this.downloadSegment(segment);
          const segmentEndTime = Date.now();
          
          // Calculate speed
          const segmentSize = segmentData.length;
          totalDownloadedBytes += segmentSize;
          
          // Update speed using the new method
          this.updateSpeed(totalDownloadedBytes);
          
          downloadedSegments[index] = segmentData;
          
          // Write segments in order
          while (currentWriteIndex < downloadedSegments.length && downloadedSegments[currentWriteIndex]) {
            const dataToWrite = downloadedSegments[currentWriteIndex];
            await new Promise((resolveWrite, rejectWrite) => {
              this.writer.write(dataToWrite, (err) => {
                if (err) return rejectWrite(err);
                resolveWrite();
              });
            });
            
            this.currentSegments++;
            this.downloadedBytes += dataToWrite.length;
            currentWriteIndex++;
            
            // Update metadata for resume capability
            const metadata = {
              url: this.streamUrl,
              segmentsCount: this.Segments.length,
              downloadedSegments: this.currentSegments,
              epid: this.EpID,
              title: this.caption
            };
            fs.writeFileSync(this.metadataFile, JSON.stringify(metadata, null, 2));
            
            await this.logProgress();
          }
          
        } catch (err) {
          logger.error(`Failed to download segment ${index}:`, err.message);
          reject(err);
          return;
        }
        
        activeTasks--;
        
        // Start next segment if we have capacity
        const nextIndex = index + maxConcurrent;
        if (nextIndex < segmentsToDownload.length) {
          processSegment(nextIndex);
        }
        
        // Check if we're done
        if (activeTasks === 0 && currentWriteIndex >= segmentsToDownload.length) {
          resolve();
        }
      };
      
      // Start initial batch
      for (let i = 0; i < Math.min(maxConcurrent, segmentsToDownload.length); i++) {
        processSegment(i);
      }
    });
  }

  async downloadSegment(segmentUrl) {
    const response = await got(segmentUrl, {
      headers: this.headers ?? {},
      responseType: "buffer",
    });
    return response.body;
  }

  pauseDownload() {
    this.isPaused = true;
    logger.info(`Download paused for ${this.caption}`);
  }

  resumeDownload() {
    this.isPaused = false;
    logger.info(`Download resumed for ${this.caption}`);
  }

  updateSpeed(newBytes) {
    const now = Date.now();
    const timeDiff = (now - this.lastSpeedUpdate) / 1000; // seconds
    const bytesDiff = newBytes - this.lastDownloadedBytes;
    
    if (timeDiff > 0.5) { // Update speed every 500ms
      this.speed = bytesDiff / timeDiff;
      this.lastSpeedUpdate = now;
      this.lastDownloadedBytes = newBytes;
      
      // Also calculate average speed as fallback
      const totalTime = (now - this.startTime) / 1000;
      const avgSpeed = totalTime > 0 ? newBytes / totalTime : 0;
      
      // Use the higher of recent speed or average speed for better UX
      if (avgSpeed > this.speed * 1.5 || this.speed === 0) {
        this.speed = avgSpeed;
      }
    }
  }

  // Check Subtitles & download
  async CheckSubtitles() {
    if (this.subtitles.length === 0) return;

    try {
      const SubTitleDir = path.join(this.directory, `subs`);
      if (!fs.existsSync(SubTitleDir)) {
        fs.mkdirSync(SubTitleDir, { recursive: true });
      }

      const downloadPromises = this.subtitles.map(async ({ url, lang }) => {
        try {
          const normalizedLang =
            iso6391.getCode(lang) ||
            (() => {
              const cleaned = (lang ?? "")
                .trim()
                .replace(/[^a-z]/gi, "")
                .toLowerCase();
              return cleaned ? cleaned?.slice(0, 3) : "und";
            })();

          const urlObj = new URL(url);
          const baseName = path.basename(urlObj.pathname);
          const ext = path.extname(baseName).replace(".", "") || "srt";

          let finalExt = ext;
          let subtitleData = await got(url).text();

          if (ext === "vtt") {
            subtitleData = this.convertToSRT(subtitleData);
            finalExt = "srt";
          }

          const subtitlePath = path.join(
            SubTitleDir,
            `${this.Epnum}Ep.${normalizedLang}.${finalExt}`
          );

          if (!fs.existsSync(subtitlePath)) {
            await fs.promises.writeFile(subtitlePath, subtitleData, "utf8");
            this.downloadedPaths.push(subtitlePath);
          }
        } catch (err) {
          logger.error(`Failed to download subtitle : ${url} (${lang})`);
          logger.error(`Error message: ${err.message}`);
          logger.error(`Stack trace: ${err.stack}`);
        }
      });

      await Promise.all(downloadPromises);
      this.currentSegments += this.subtitles.length;
    } catch (err) {
      logger.error(`Failed to process subtitles`);
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
    }
  }

  // Convert To Srt
  convertToSRT(content) {
    try {
      const lines = content.split(/\r?\n/);
      const srtLines = [];
      let index = 1;
      let buffer = [];
      let lastEnd = 0;

      const timeRegex =
        /^(\d{2}:)?\d{2}:\d{2}[\.,]\d{3} --> (\d{2}:)?\d{2}:\d{2}[\.,]\d{3}$/;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim().replace(/<[^>]+>/g, "");

        if (!line || line.startsWith("WEBVTT")) continue;

        if (timeRegex.test(line)) {
          if (buffer.length) {
            srtLines.push(String(index++));
            srtLines.push(...buffer);
            srtLines.push("");
            buffer = [];
          }

          let [start, end] = line.split(" --> ");
          const startMs = this.toMs(start);
          const endMs = this.toMs(end);

          const adjustedStart = Math.max(startMs, lastEnd + 1);
          if (endMs <= adjustedStart) continue;

          lastEnd = endMs;

          buffer.push(`${this.toSRT(adjustedStart)} --> ${this.toSRT(endMs)}`);
        } else if (buffer.length) {
          buffer.push(line);
        }
      }

      if (buffer.length) {
        srtLines.push(String(index++));
        srtLines.push(...buffer);
        srtLines.push("");
      }

      return srtLines.join("\n");
    } catch (err) {
      console.warn("Subtitle conversion failed:", err.message);
      return content;
    }
  }

  toMs(timeStr) {
    const clean = timeStr.replace(",", ".");
    const parts = clean.split(":");
    const [sec, ms] = parts[parts.length - 1].split(".");
    const s = parseInt(sec);
    const m = parseInt(parts[parts.length - 2]);
    const h = parts.length === 3 ? parseInt(parts[0]) : 0;

    return h * 3600000 + m * 60000 + s * 1000 + parseInt(ms);
  }

  toSRT(ms) {
    const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const msStr = String(ms % 1000).padStart(3, "0");
    return `${h}:${m}:${s},${msStr}`;
  }

  // Merge .ts to mp4
  async MergeSegments() {
    try {
      const ffmpegArgs = [
        "-y",
        "-i",
        this.SegmentsFile,
        "-c",
        "copy",
        this.mp4,
      ];

      await new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, ffmpegArgs);

        child.on("close", (code) => {
          if (code !== 0) {
            return reject(new Error(`FFmpeg exited with code ${code}`));
          }
          resolve();
        });

        child.on("error", (err) => {
          reject(new Error(`Failed to start FFmpeg: ${err.message}`));
        });
      });

      this.currentSegments++;
      await this.logProgress();
      await this.CleanEverything();
    } catch (err) {
      await this.CleanEverything(true);
      throw err;
    }
  }

  getLangCodeFromFilename(filePath) {
    let FileName = path?.basename(filePath)?.split("_")?.[1];
    if (!FileName) return "und";
    FileName =
      FileName?.split(".srt")?.[0]?.slice(0, 3)?.toLocaleLowerCase() ?? "und";
    return FileName;
  }

  async logProgress(ExtraMessage) {
    let caption = this.caption;
    if (this.currentSegments >= this.totalSegments - 3) {
      caption = caption.replace("Downloading", "Merging");
    }

    if (ExtraMessage) caption += ExtraMessage;

    // Calculate speed in human readable format
    const speedFormatted = this.formatSpeed(this.speed);
    
    await fetch(`http://localhost:${global.PORT}/api/logger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caption: caption,
        totalSegments: this.totalSegments + 1,
        currentSegments: this.currentSegments,
        epid: this.EpID,
        speed: speedFormatted,
        threads: this.threads,
        isPaused: this.isPaused,
      }),
    }).catch((err) => {
      logger.error("Error updating download progress");
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
    });
  }

  formatSpeed(bytesPerSecond) {
    if (!bytesPerSecond || bytesPerSecond === 0 || isNaN(bytesPerSecond)) return "0 B/s";
    
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    let unitIndex = 0;
    let speed = bytesPerSecond;
    
    while (speed >= 1024 && unitIndex < units.length - 1) {
      speed /= 1024;
      unitIndex++;
    }
    
    return `${speed.toFixed(1)} ${units[unitIndex]}`;
  }

  async CleanEverything(everything = false) {
    // remove ts file
    await fs.promises.unlink(this.SegmentsFile).catch(() => {});

    // remove metadata file
    if (this.metadataFile) {
      await fs.promises.unlink(this.metadataFile).catch(() => {});
    }

    // remove mp4 ( only on error )
    if (everything) {
      await fs.promises.unlink(this.mp4).catch(() => {});
    }
  }
}

async function download(args) {
  let obj = new downloader(args);
  try {
    // Store the instance for pause/resume control
    global.activeDownloads.set(args.EpID, obj);
    
    await obj.DownloadsChecking();
    await obj.DownloadStart();
    await obj.CheckSubtitles();
    await obj.MergeSegments();
    
    // Remove from active downloads on completion
    global.activeDownloads.delete(args.EpID);
  } catch (err) {
    await obj.CleanEverything();
    global.activeDownloads.delete(args.EpID);
    console.log(err);
    logger.error(err);
    throw new Error(err);
  }
}

// Global download instances for pause/resume functionality
global.activeDownloads = new Map();

module.exports = { download, downloader };
