const express = require('express');
const http = require('http');
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000; // Hosting platformunun verdiği portu kullanabilmek için önemli
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Her yerden gelen isteklere izin ver (geliştirme için)
    }
});

// Eşleşmeleri ve istemcileri takip etmek için kullanılan haritalar
const pcClients = new Map(); // Key: socket.id, Value: pairingCode
const pairedConnections = new Map(); // Key: socket.id, Value: paired_socket.id

console.log('Merkezi sunucu başlatılıyor...');

io.on('connection', (socket) => {
    console.log(`Yeni bir bağlantı: ${socket.id}`);

    // PC istemcisi kendini kaydettiğinde çalışır
    socket.on('register-pc', () => {
        // Benzersiz, 6 haneli yeni bir kod üret
        let newCode;
        do {
            newCode = Math.floor(100000 + Math.random() * 900000).toString();
        } while (Array.from(pcClients.values()).includes(newCode)); // Kodun başka bir PC tarafından kullanılmadığından emin ol

        pcClients.set(socket.id, newCode);
        console.log(`PC [${socket.id}] kendini kaydetti ve [${newCode}] kodunu aldı.`);
        
        // Üretilen kodu sadece o PC'ye geri gönder
        socket.emit('your-code', newCode);
    });

    // Mobil istemci eşleşme isteği gönderdiğinde çalışır
    socket.on('pair-request', (code) => {
        let pcSocketId = null;
        // Gelen kod hangi PC'ye ait?
        for (let [socketId, pairingCode] of pcClients.entries()) {
            if (pairingCode === code) {
                pcSocketId = socketId;
                break;
            }
        }

        // Koda karşılık gelen bir PC bulunduysa
        if (pcSocketId && io.sockets.sockets.has(pcSocketId)) {
            // İki tarafı birbirine bağla
            pairedConnections.set(socket.id, pcSocketId); // Telefon -> PC
            pairedConnections.set(pcSocketId, socket.id); // PC -> Telefon

            // Eşleşme başarılı bilgisini iki tarafa da gönder
            io.to(pcSocketId).emit('pair-success'); // PC'ye
            socket.emit('pair-success'); // Telefona

            // Kod artık kullanıldığı için PC'yi bekleme listesinden çıkar
            pcClients.delete(pcSocketId);
            console.log(`BAŞARILI EŞLEŞME: Telefon [${socket.id}] ile PC [${pcSocketId}] bağlandı.`);
        } else {
            // Kod geçersiz veya PC artık bağlı değil
            socket.emit('pair-fail', 'Geçersiz veya süresi dolmuş kod.');
            console.log(`BAŞARISIZ EŞLEŞME: Telefon [${socket.id}] geçersiz kod [${code}] denedi.`);
        }
    });
    
    // Telefondan gelen kontrol komutlarını PC'ye ilet
    socket.on('control-command', (command) => {
        const targetSocketId = pairedConnections.get(socket.id);
        if (targetSocketId && io.sockets.sockets.has(targetSocketId)) {
            console.log(`Komut [${socket.id}] -> [${targetSocketId}]:`, command);
            io.to(targetSocketId).emit('execute-command', command);
        }
    });

    // Bağlantı koptuğunda
    socket.on('disconnect', () => {
        console.log(`Bağlantı koptu: ${socket.id}`);
        // Eğer bu bir PC ise bekleme listesinden kaldır
        if (pcClients.has(socket.id)) {
            pcClients.delete(socket.id);
            console.log(`Beklemedeki PC [${socket.id}] ayrıldı.`);
        }
        // Eğer bu bir eşleşmiş istemci ise, karşı tarafı bilgilendir ve bağlantıyı kopar
        const targetSocketId = pairedConnections.get(socket.id);
        if (targetSocketId) {
            io.to(targetSocketId).emit('partner-disconnected');
            pairedConnections.delete(socket.id);
            pairedConnections.delete(targetSocketId);
            console.log(`Eşleşmiş istemci [${socket.id}] ayrıldı. Eşleşme çözüldü.`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Postane sunucusu ${PORT} portunda dinlemede...`);
});