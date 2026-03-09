param(
  [string]$ServerHost = "140.245.71.36",
  [string]$ServerUser = "ubuntu",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\oci-ranchat-backup.key",
  [string]$RemoteDir = "/opt/rtc-signal"
)

$ErrorActionPreference = "Stop"

function Run-Ssh([string]$Command) {
  & ssh -i $KeyPath "$ServerUser@$ServerHost" $Command
}

function Run-Scp([string]$LocalPath, [string]$RemotePath) {
  & scp -i $KeyPath $LocalPath "${ServerUser}@${ServerHost}:${RemotePath}"
}

Run-Scp "C:\ranchat\tmp_server_remote.js" "$RemoteDir/server.js"
Run-Scp "C:\ranchat\ai_reply_worker.js" "$RemoteDir/ai_reply_worker.js"
Run-Scp "C:\ranchat\ecosystem.config.js" "$RemoteDir/ecosystem.config.js"
Run-Scp "C:\ranchat\ecosystem.config.cjs" "$RemoteDir/ecosystem.config.cjs"
Run-Scp "C:\ranchat\translate_routes.js" "$RemoteDir/translate_routes.js"

Run-Ssh @"
set -e
cd $RemoteDir
sudo nginx -t
sudo systemctl reload nginx
swap_size=`$(stat -c%s /swapfile 2>/dev/null || echo 0)
if [ ! -f /swapfile ] || [ "`$swap_size" -lt 5368709120 ]; then
  sudo swapoff /swapfile 2>/dev/null || true
  sudo rm -f /swapfile
  sudo fallocate -l 5G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=5120 status=progress
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
fi
sudo swapon /swapfile || true
sudo sed -i '/^\/swapfile[[:space:]]/d' /etc/fstab
echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
sudo sysctl vm.swappiness=10 >/dev/null
sudo sed -i '/^vm\.swappiness=/d' /etc/sysctl.conf
echo "vm.swappiness=10" | sudo tee -a /etc/sysctl.conf >/dev/null
pm2 startOrRestart ecosystem.config.js --update-env
sleep 5
pm2 status
curl -fsS http://127.0.0.1:3001/health
curl -fsS http://127.0.0.1:3002/health
swapon --show
sysctl vm.swappiness
"@
