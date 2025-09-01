var bar = new ldBar(".myBar", {
  max: 100,
  preset: "rainbow",
  value: 0,
});

var barvar = document.getElementById("myBar");
barvar.style.display = "none";

let currentEpid = null;
let isPaused = false;

window.sharedStateAPI.on("download-logger", (data) => {
  UpdateBar(data);
});

UpdateBar();

async function UpdateBar(data = null) {
  try {
    if (!data) {
      let QueueData = await fetch("/downloads", {
        method: "POST",
      });
      data = await QueueData.json();
    }

    if (!bar) return;

    var captionElement = document.getElementById("caption");
    var downloadStatsElement = document.getElementById("downloadStats");

    var ratio =
      data?.currentSegments && data?.totalSegments
        ? Math.floor((data.currentSegments / data.totalSegments) * 100)
        : 0;

    if (ratio >= 100 && (!data.queue || data.queue.length === 0)) {
      captionElement.innerHTML = "Nothing to Download";
      downloadStatsElement.style.display = "none";
    } else {
      captionElement.innerHTML = data?.caption || "Nothing to Download";
      
      // Always show download stats if we have any download data or active queue
      if (data && (data.speed || data.threads || ratio > 0 || (data.queue && data.queue.length > 0))) {
        downloadStatsElement.style.display = "block";
        
        // Update speed - with debug logging
        const speedValue = data.speed || "0 B/s";
        document.getElementById("downloadSpeed").textContent = speedValue;
        
        // Update thread count - show actual threads being used for current download
        const actualThreads = data.threads || "4";
        document.getElementById("threadCount").textContent = actualThreads;
        
        // Update progress percentage
        document.getElementById("downloadProgress").textContent = ratio + "%";
        
        // Update pause/resume button state
        isPaused = data.isPaused || false;
        currentEpid = data.epid || null;
        
        const pauseBtn = document.getElementById("pauseBtn");
        const resumeBtn = document.getElementById("resumeBtn");
        
        if (isPaused) {
          pauseBtn.style.display = "none";
          resumeBtn.style.display = "inline-block";
        } else {
          pauseBtn.style.display = "inline-block";
          resumeBtn.style.display = "none";
        }
      } else {
        downloadStatsElement.style.display = "none";
      }
    }

    var barvar = document.getElementById("myBar");
    if (ratio < 100 && ratio > 0) {
      barvar.style.display = "block";
      bar.set(ratio);
    } else {
      bar.set(0);
      barvar.style.display = "none";
    }

    var queueContainer = document.getElementById("queue");
    var queueItemsContainer = document.getElementById("queue-items");

    let scrollTop = null;
    if (!queueItemsContainer) {
      queueItemsContainer = document.createElement("div");
      queueItemsContainer.id = "queue-items";
      queueContainer.appendChild(queueItemsContainer);
    } else {
      scrollTop = queueItemsContainer.scrollTop;
      queueItemsContainer.innerHTML = "";
    }

    if (data.queue && data.queue.length > 0) {
      queueContainer.innerHTML = `
      <div class="queue-header">
        <div class="queue-title">
          <div class="caption">In Queue</div>
        </div>
        <div class="queue-buttons">
          <button onclick="removeAllFromQueue()" class="btn btn-outline-danger">Remove All</button>
        </div>
      </div>`;

      queueContainer.appendChild(queueItemsContainer);

      data.queue.forEach((item) => {
        var queueItem = document.createElement("div");
        queueItem.classList.add("queue-item");
        queueItem.innerHTML = `
        <span>${item.Title} - ${item.EpNum}</span>
        <span class="remove-icon" onclick="removeFromQueue('${item.Title}', '${item.EpNum}', '${item.epid}')">🗑️</span>`;
        queueItemsContainer.appendChild(queueItem);
      });
    } else {
      queueContainer.innerHTML = "";
    }

    if (scrollTop) queueItemsContainer.scrollTop = scrollTop;
  } catch (err) {
    console.log(err);
  }
}

function removeAllFromQueue() {
  fetch("/api/download/remove", {
    method: "GET",
  })
    .then((response) => response.json())
    .then((data) => {
      Swal.fire({
        icon: "success",
        title: "Queue Updated!",
        text: "Removed Everything!",
      });
    })
    .catch((err) => {
      Swal.fire({
        icon: "error",
        title: "Failed To Update Queue",
        text: "Something Went Wrong...",
      });
    });
}

function removeFromQueue(Title, startep, epdownload) {
  fetch(`/api/download/remove?AnimeEpId=${epdownload}`, {
    method: "GET",
  })
    .then((response) => response.json())
    .then((data) => {
      Swal.fire({
        icon: "success",
        title: "Queue Updated!",
        text: `Removed ${Title} | ${startep}!`,
      });
    })
    .catch((err) => {
      Swal.fire({
        icon: "error",
        title: "Failed To Update Queue",
        text: "Something Went Wrong...",
      });
    });
}

// Pause download functionality
async function pauseDownload() {
  try {
    const response = await fetch("/api/download/pause", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ epid: currentEpid }),
    });
    
    const result = await response.json();
    
    if (response.ok) {
      isPaused = true;
      document.getElementById("pauseBtn").style.display = "none";
      document.getElementById("resumeBtn").style.display = "inline-block";
      
      Swal.fire({
        icon: "success",
        title: "Download Paused",
        text: "Download has been paused successfully.",
        timer: 2000,
        showConfirmButton: false,
      });
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    Swal.fire({
      icon: "error",
      title: "Failed to Pause",
      text: "Could not pause the download.",
    });
  }
}

// Resume download functionality
async function resumeDownload() {
  try {
    const response = await fetch("/api/download/resume", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ epid: currentEpid }),
    });
    
    const result = await response.json();
    
    if (response.ok) {
      isPaused = false;
      document.getElementById("pauseBtn").style.display = "inline-block";
      document.getElementById("resumeBtn").style.display = "none";
      
      Swal.fire({
        icon: "success",
        title: "Download Resumed",
        text: "Download has been resumed successfully.",
        timer: 2000,
        showConfirmButton: false,
      });
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    Swal.fire({
      icon: "error",
      title: "Failed to Resume",
      text: "Could not resume the download.",
    });
  }
}

// Update thread count functionality
async function updateThreadCount() {
  const threadSelect = document.getElementById("threadSelect");
  const selectedThreads = threadSelect.value;
  
  // Store the preference in localStorage and send to backend
  localStorage.setItem("preferredThreads", selectedThreads);
  
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ threads: parseInt(selectedThreads) }),
    });
    
    const result = await response.json();
    
    if (response.ok) {
      // Show notification with additional info about queue updates
      Swal.fire({
        icon: "success",
        title: "Thread Count Updated",
        text: `Thread count set to ${selectedThreads}. This will apply to new downloads and queued downloads that haven't started yet.`,
        timer: 3000,
        showConfirmButton: false,
      });
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    Swal.fire({
      icon: "error",
      title: "Failed to Update",
      text: "Could not update thread count setting.",
    });
  }
}

// Load preferred thread count on page load
document.addEventListener("DOMContentLoaded", function() {
  const preferredThreads = localStorage.getItem("preferredThreads") || "4";
  const threadSelect = document.getElementById("threadSelect");
  if (threadSelect) {
    threadSelect.value = preferredThreads;
  }
});

// Also load on window load as backup
window.addEventListener("load", function() {
  const preferredThreads = localStorage.getItem("preferredThreads") || "4";
  const threadSelect = document.getElementById("threadSelect");
  if (threadSelect) {
    threadSelect.value = preferredThreads;
  }
});
