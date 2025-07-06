# scripts/upgrade-system.sh

#!/bin/bash
set -e

sudo apt-get update
sudo apt-get upgrade -y
sudo apt-get dist-upgrade -y
sudo apt autoremove -y

# Run release upgrade
if command -v do-release-upgrade >/dev/null 2>&1; then
    echo "Running do-release-upgrade..."
    sudo do-release-upgrade -f DistUpgradeViewNonInteractive
else
    echo "'do-release-upgrade' not found. Skipping release upgrade."
fi

# Restart services if needed (using needrestart if available)
if command -v needrestart >/dev/null 2>&1; then
    sudo needrestart -r a
else
    echo "Consider installing 'needrestart' to automatically restart services if needed."
fi

# Reboot the system
echo "Rebooting in 10 seconds. Press Ctrl+C to cancel."
sleep 10
sudo reboot
