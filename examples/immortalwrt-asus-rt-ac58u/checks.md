# Controlli di sicurezza del firmware: ImmortalWrt 18.06-k5.4 per ASUS RT-AC58U (build 2023-03-09)

| ID | Controllo | Esito | CRA Allegato I | ETSI EN 303 645 |
|---|---|---|---|---|
| C01 | Password dell'account root | ❌ FAIL | I.2(b), I.2(d) | 5.1 |
| C02 | Chiavi private incorporate nell'immagine | ❌ FAIL | I.2(e), I.2(f) | 5.4 |
| C03 | Chiavi host SSH pregenerate | ✅ PASS | I.2(e) | 5.4 |
| C04 | Servizi con protocolli in chiaro | ✅ PASS | I.2(j) | 5.6 |
| C05 | Servizi avviati di default | ⚠️ WARN | I.2(j) | 5.6 |
| C06 | Verifica della firma degli aggiornamenti | ❌ FAIL | II(7) | 5.3 |
| C07 | Firewall sulla WAN | ⚠️ WARN | I.2(j) | 5.6 |
| C08 | Binari setuid/setgid | ℹ️ INFO | I.2(k) | 5.6 |
| C09 | Hardening dei binari (protezioni del compilatore) | ❌ FAIL | I.2(k) | 5.6 |

## C01 · Password dell'account root: FAIL

L'account root non ha password al primo avvio. Chi raggiunge il dispositivo prima del proprietario può autenticarsi. Serve una password unica per dispositivo o l'obbligo di impostarla prima di attivare i servizi di rete.

```
/etc/shadow: root::
```

## C02 · Chiavi private incorporate nell'immagine: FAIL

Nell'immagine ci sono chiavi private: sono identiche su ogni dispositivo e chiunque può estrarle dal firmware pubblico.

```
/etc/openvpn/server.key  (pacchetto luci-app-openvpn-server)
/etc/openvpn/client1.key  (pacchetto luci-app-openvpn-server)
/etc/easy-rsa/keys/server.key  (pacchetto luci-app-openvpn-server)
/etc/easy-rsa/keys/client1.key  (pacchetto luci-app-openvpn-server)
/etc/easy-rsa/keys/ca.key  (pacchetto luci-app-openvpn-server)
```

## C03 · Chiavi host SSH pregenerate: PASS

Le chiavi host SSH sono assenti o vuote: vengono generate al primo avvio, uniche per dispositivo.

## C04 · Servizi con protocolli in chiaro: PASS

Nessun server Telnet, FTP o TFTP trovato.

## C05 · Servizi avviati di default: WARN

77 servizi abilitati al boot, di cui 11 esposti in rete: aria2, dropbear, haproxy, netdata, nfsd, openvpn, rpcbind, samba, snmpd, transmission, uhttpd. Ogni servizio attivo di default va giustificato nel risk assessment.

```
adjust_network
aria2
arpbind
boot
bootcount
cgroupfs-mount
cifs
cpufreq
cpulimit
cron
dbus
ddns
dnsforwarder
dnsmasq
dnsproxy
done
dropbear
eqos
firewall
frp
fstab
gowebdav
gpio_switch
guest-wifi
haproxy
hd-idle
irqbalance
led
log
mdadm
…
```

## C06 · Verifica della firma degli aggiornamenti: FAIL

In /etc/opkg.conf manca 'option check_signature': opkg non verifica la firma degli indici dei pacchetti, da cui dipende anche il controllo dell'hash di ogni pacchetto, anche se nell'immagine ci sono 6 chiavi usign. Chi controlla il repository o la rete può far installare pacchetti modificati.

```
/etc/opkg.conf: check_signature assente
/etc/opkg/keys: 6 chiavi
```

## C07 · Firewall sulla WAN: WARN

La policy di ingresso WAN è REJECT, ma 3 regole aprono porte verso Internet. Ogni apertura va giustificata; se il servizio è disattivato, la regola non dovrebbe esistere.

```
/etc/config/firewall: Allow-DHCP-Renew -> porta 68
/etc/config/firewall: Allow-DHCPv6 -> porta 546
/etc/uci-defaults/openvpn: regola 'openvpn' apre dalla WAN la porta $openvpn_port (default 1194)
```

## C08 · Binari setuid/setgid: INFO

0 file con bit setuid o setgid (possibili vie di escalation dei privilegi).

## C09 · Hardening dei binari (protezioni del compilatore): FAIL

223 eseguibili analizzati. NX 100%, PIE 7%, RELRO completo 99%, stack canary 77%, FORTIFY non misurabile (con musl è implementato da header inline che non lasciano simboli). Le protezioni del compilatore mitigano lo sfruttamento di buffer overflow e bug di memoria.

```
Senza PIE né canary: /bin/coremark
Senza PIE né canary: /sbin/mount_root
Senza PIE né canary: /sbin/jffs2reset
Senza PIE né canary: /sbin/uci
Senza PIE né canary: /sbin/partprobe
Senza PIE né canary: /sbin/validate_data
Senza PIE né canary: /sbin/logd
Senza PIE né canary: /usr/bin/gpioget
Senza PIE né canary: /usr/bin/brook
Senza PIE né canary: /usr/bin/transmission-create
Senza PIE né canary: /usr/bin/shellsync
Senza PIE né canary: /usr/bin/gpiomon
Senza PIE né canary: /usr/bin/npc
Senza PIE né canary: /usr/bin/dbus-uuidgen
Senza PIE né canary: /usr/bin/chinadns-ng
Senza PIE né canary: /usr/bin/hysteria
Senza PIE né canary: /usr/bin/transmission-edit
Senza PIE né canary: /usr/bin/gowebdav
Senza PIE né canary: /usr/bin/gpioctl
Senza PIE né canary: /usr/bin/kcptun-client
Senza PIE né canary: /usr/bin/gpiodetect
Senza PIE né canary: /usr/bin/frpc
Senza PIE né canary: /usr/bin/trojan-go
Senza PIE né canary: /usr/bin/dnsproxy
Senza PIE né canary: /usr/bin/gpioset
```
