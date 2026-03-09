param(
  [string]$ServerHost = "140.245.71.36",
  [string]$ServerUser = "ubuntu",
  [string]$KeyPath = "$env:USERPROFILE\.ssh\oci-ranchat-backup.key",
  [string]$TurnDomain = "comspc.duckdns.org",
  [string]$TurnUsername = "testuser",
  [string]$TurnPassword = "testpass",
  [string]$PublicIp = "140.245.71.36",
  [string]$PrivateIp = "10.0.0.78",
  [int]$TurnPort = 3478,
  [int]$TurnTlsPort = 5349,
  [int]$RelayMinPort = 49160,
  [int]$RelayMaxPort = 49200
)

$ErrorActionPreference = "Stop"

function Run-Ssh([string]$Command) {
  & ssh -i $KeyPath "$ServerUser@$ServerHost" $Command
}

$turnConfig = @"
listening-port=$TurnPort
tls-listening-port=$TurnTlsPort
listening-ip=0.0.0.0
relay-ip=$PrivateIp
external-ip=$PublicIp/$PrivateIp
realm=$TurnDomain
server-name=$TurnDomain
fingerprint
lt-cred-mech
user=$($TurnUsername):$($TurnPassword)
cert=/etc/turnserver/fullchain.pem
pkey=/etc/turnserver/privkey.pem
no-cli
no-tlsv1
no-tlsv1_1
min-port=$RelayMinPort
max-port=$RelayMaxPort
stale-nonce
simple-log
no-multicast-peers
"@

$remoteCommand = @"
set -e
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y coturn
sudo apt-get install -y iptables-persistent
echo 'TURNSERVER_ENABLED=1' | sudo tee /etc/default/coturn >/dev/null
sudo install -d -m 750 -o root -g turnserver /etc/turnserver
sudo install -m 640 -o root -g turnserver /etc/letsencrypt/live/$TurnDomain/fullchain.pem /etc/turnserver/fullchain.pem
sudo install -m 640 -o root -g turnserver /etc/letsencrypt/live/$TurnDomain/privkey.pem /etc/turnserver/privkey.pem
cat <<'EOF' | sudo tee /etc/turnserver.conf >/dev/null
$turnConfig
EOF
sudo iptables -C INPUT -p tcp --dport $TurnPort -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport $TurnPort -j ACCEPT
sudo iptables -C INPUT -p udp --dport $TurnPort -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p udp --dport $TurnPort -j ACCEPT
sudo iptables -C INPUT -p tcp --dport $TurnTlsPort -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport $TurnTlsPort -j ACCEPT
sudo iptables -C INPUT -p udp --dport $TurnTlsPort -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p udp --dport $TurnTlsPort -j ACCEPT
sudo iptables -C INPUT -p tcp --dport $($RelayMinPort):$($RelayMaxPort) -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p tcp --dport $($RelayMinPort):$($RelayMaxPort) -j ACCEPT
sudo iptables -C INPUT -p udp --dport $($RelayMinPort):$($RelayMaxPort) -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p udp --dport $($RelayMinPort):$($RelayMaxPort) -j ACCEPT
sudo install -d -m 755 /etc/iptables
sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
sudo netfilter-persistent save
sudo systemctl enable coturn
sudo systemctl restart coturn
sleep 2
sudo systemctl --no-pager --full status coturn
sudo ss -ltnup | grep -E '$TurnPort|$TurnTlsPort' || true
sudo ss -lunp | grep -E '$TurnPort|$TurnTlsPort' || true
"@

Run-Ssh $remoteCommand
