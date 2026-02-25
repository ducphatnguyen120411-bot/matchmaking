const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, 
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, 
    TextInputStyle, InteractionType, ChannelType, PermissionsBitField 
} = require('discord.js');
const mongoose = require('mongoose');
const nblox = require('noblox.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// --- KẾT NỐI DATABASE ---
mongoose.connect(process.env.MONGO_URI).then(() => console.log("✅ MongoDB Connected"));

const User = mongoose.model('User', new mongoose.Schema({
    discordId: String, 
    robloxId: String, 
    robloxName: String,
    elo: { type: Number, default: 1000 }, 
    wins: { type: Number, default: 0 }, 
    losses: { type: Number, default: 0 },
    verifyCode: String
}));

// --- CẤU HÌNH ---
const queues = { "1v1": { p: [], lim: 2 }, "2v2": { p: [], lim: 4 }, "5v5": { p: [], lim: 10 } };
let activeMatches = [];
const teamNames = ["ALPHA", "OMEGA", "RADIANT", "DIRE", "STORM", "THUNDER", "TITAN", "PHOENIX"];

const getRank = (elo) => {
    if (elo >= 1800) return { name: "LEGENDARY", color: 0xFFD700 };
    if (elo >= 1500) return { name: "SURGE", color: 0xFF0000 };
    if (elo >= 1200) return { name: "TRACE", color: 0x00FF00 };
    return { name: "UNRANKED", color: 0x888888 };
};

client.on('ready', () => console.log(`🚀 Bot Online: ${client.user.tag}`));

// --- XỬ LÝ LỆNH CHAT ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const args = message.content.split(' ');

    // 1. SETUP VERIFY (Bảng điều khiển 3 nút)
    if (message.content === '!setup-verify' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const embed = new EmbedBuilder()
            .setTitle("🔒 PrimeBlox — Account Verification")
            .setDescription("Link your Discord account to your Roblox profile to participate in competitive matches.\n\n" +
                "ℹ️ **Verification Steps:**\n" +
                "• Click **Verify Account** below\n" +
                "• Enter your Roblox username\n" +
                "• Set your Roblox **About Me** to the code provided\n" +
                "• Press **Done** to complete")
            .setColor(0xFFAA00);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('v_start').setLabel('Verify Account').setStyle(ButtonStyle.Success).setEmoji('✅'),
            new ButtonBuilder().setCustomId('v_change').setLabel('Change Account').setStyle(ButtonStyle.Primary).setEmoji('ℹ️'),
            new ButtonBuilder().setCustomId('v_unlink').setLabel('Unlink Account').setStyle(ButtonStyle.Danger).setEmoji('🔗')
        );

        message.channel.send({ embeds: [embed], components: [row] });
    }

    // 2. LỆNH JOIN & LEAVE
    if (args[0] === '!j') {
        const mode = args[1];
        if (!queues[mode]) return message.reply("❌ `!j 1v1`, `!j 2v2` hoặc `!j 5v5`!");

        const userData = await User.findOne({ discordId: message.author.id });
        if (!userData || !userData.robloxId) return message.reply("❌ Bạn chưa xác minh tài khoản!");
        if (Object.values(queues).some(q => q.p.find(p => p.id === message.author.id))) return message.reply("⚠️ Bạn đã ở trong hàng chờ!");

        queues[mode].p.push({ id: message.author.id, name: userData.robloxName });
        message.channel.send(`✅ **${userData.robloxName}** đã vào queue **${mode}** (${queues[mode].p.length}/${queues[mode].lim})`);

        if (queues[mode].p.length === queues[mode].lim) {
            const players = [...queues[mode].p].sort(() => 0.5 - Math.random());
            const matchId = Math.floor(1000 + Math.random() * 9000);
            const rNames = teamNames.sort(() => 0.5 - Math.random());

            const category = message.guild.channels.cache.find(c => c.name.toUpperCase() === 'RANKED') || null;
            const v1 = await message.guild.channels.create({ name: `🟦 ${rNames[0]} - ${matchId}`, type: ChannelType.GuildVoice, parent: category?.id });
            const v2 = await message.guild.channels.create({ name: `🟥 ${rNames[1]} - ${matchId}`, type: ChannelType.GuildVoice, parent: category?.id });

            const matchData = {
                id: matchId, mode, t1Name: rNames[0], t1Players: players.slice(0, players.length/2),
                t2Name: rNames[1], t2Players: players.slice(players.length/2), voices: [v1.id, v2.id]
            };
            activeMatches.push(matchData);

            for (const p of players) {
                const mem = await message.guild.members.fetch(p.id).catch(() => null);
                const targetV = matchData.t1Players.find(tp => tp.id === p.id) ? v1 : v2;
                if (mem?.voice.channel) mem.voice.setChannel(targetV).catch(() => {});
            }

            message.channel.send({ content: "@everyone", embeds: [new EmbedBuilder().setTitle(`⚔️ MATCH FOUND: ${mode} (#${matchId})`)
                .addFields({ name: `🟦 ${matchData.t1Name}`, value: matchData.t1Players.map(p => `• ${p.name}`).join('\n'), inline: true },
                           { name: `🟥 ${matchData.t2Name}`, value: matchData.t2Players.map(p => `• ${p.name}`).join('\n'), inline: true })
                .setColor(0xFFAA00)] });
            queues[mode].p = [];
        }
    }

    if (args[0] === '!leave') {
        for (const mode in queues) {
            const idx = queues[mode].p.findIndex(p => p.id === message.author.id);
            if (idx !== -1) {
                queues[mode].p.splice(idx, 1);
                return message.reply(`✅ Đã rời khỏi hàng chờ **${mode}**.`);
            }
        }
        message.reply("⚠️ Bạn không ở trong hàng chờ nào.");
    }

    // 3. LỆNH WIN (HIỆN EMBED KẾT QUẢ XỊN)
    if (args[0] === '!win' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        const mId = parseInt(args[1]);
        const winnerInput = args[2]?.toUpperCase();
        const mIdx = activeMatches.findIndex(m => m.id === mId);
        if (mIdx === -1) return message.reply("❌ ID trận không tồn tại!");

        const match = activeMatches[mIdx];
        const isT1Win = (winnerInput === match.t1Name);
        const winners = isT1Win ? match.t1Players : match.t2Players;
        const losers = isT1Win ? match.t2Players : match.t1Players;

        let resWin = "", resLose = "";

        for (const p of winners) {
            const d = await User.findOneAndUpdate({ discordId: p.id }, { $inc: { elo: 25, wins: 1 } }, { new: true });
            resWin += `• **${p.name}**: +25 ELO\n`;
            const u = await client.users.fetch(p.id).catch(() => null);
            if (u) u.send({ embeds: [new EmbedBuilder().setTitle("🏆 WIN!").setDescription(`Bạn nhận được +25 ELO từ trận #${match.id}`).setColor(0x00FF00)] }).catch(() => {});
        }
        for (const p of losers) {
            const d = await User.findOneAndUpdate({ discordId: p.id }, { $inc: { elo: -20, losses: 1 } }, { new: true });
            resLose += `• **${p.name}**: -20 ELO\n`;
            const u = await client.users.fetch(p.id).catch(() => null);
            if (u) u.send({ embeds: [new EmbedBuilder().setTitle("❌ LOSS").setDescription(`Bạn bị trừ -20 ELO từ trận #${match.id}`).setColor(0xFF0000)] }).catch(() => {});
        }

        match.voices.forEach(id => message.guild.channels.cache.get(id)?.delete().catch(() => {}));
        
        const finalEmbed = new EmbedBuilder()
            .setTitle("🔒 MATCH ENDED")
            .setDescription(`## 🏆 WINNER: TEAM ${winnerInput}\n**ID:** ${match.id} | **Mode:** ${match.mode}`)
            .addFields(
                { name: `🟦 ${match.t1Name}`, value: isT1Win ? resWin : resLose, inline: true },
                { name: `🟥 ${match.t2Name}`, value: !isT1Win ? resWin : resLose, inline: true }
            )
            .setColor(0x5865F2).setTimestamp();

        message.channel.send({ embeds: [finalEmbed] });
        activeMatches.splice(mIdx, 1);
    }

    // 4. LỆNH LB (BẢNG XẾP HẠNG) & STATS
    if (args[0] === '!lb' || args[0] === '!top') {
        const top = await User.find().sort({ elo: -1 }).limit(10);
        let desc = top.map((u, i) => `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `**#${i+1}**`} \`${u.robloxName}\` - **${u.elo}**`).join('\n');
        message.channel.send({ embeds: [new EmbedBuilder().setTitle("🏆 TOP 10 LEADERBOARD").setDescription(desc || "Chưa có dữ liệu").setColor(0xFFAA00)] });
    }

    if (args[0] === '!stats') {
        const target = message.mentions.users.first() || message.author;
        const data = await User.findOne({ discordId: target.id });
        if (!data) return message.reply("Chưa xác minh!");
        const rank = getRank(data.elo);
        const embed = new EmbedBuilder().setAuthor({ name: `${data.robloxName}'s Statistics`, iconURL: target.displayAvatarURL() })
            .addFields({ name: 'Rank', value: rank.name, inline: true }, { name: 'ELO', value: `\`${data.elo}\``, inline: true }, { name: 'W/L', value: `\`${data.wins}W - ${data.losses}L\``, inline: true })
            .setColor(rank.color);
        message.reply({ embeds: [embed] });
    }
});

// --- XỬ LÝ INTERACTION (VERIFY MODAL & BUTTONS) ---
client.on('interactionCreate', async (i) => {
    if (i.customId === 'v_start' || i.customId === 'v_change') {
        const m = new ModalBuilder().setCustomId('modal_v').setTitle('Verify Roblox Account');
        m.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('r_username').setLabel("Roblox Username").setStyle(TextInputStyle.Short).setRequired(true)));
        return i.showModal(m);
    }

    if (i.type === InteractionType.ModalSubmit && i.customId === 'modal_v') {
        const username = i.fields.getTextInputValue('r_username');
        try {
            const robloxId = await nblox.getIdFromUsername(username);
            const code = `PB-${Math.floor(10000 + Math.random() * 90000)}`;
            await User.findOneAndUpdate({ discordId: i.user.id }, { robloxName: username, robloxId, verifyCode: code }, { upsert: true });

            const embed = new EmbedBuilder()
                .setTitle("🛠️ Verification Step")
                .setDescription(`Hãy đổi **About Me** trên profile Roblox của bạn thành mã sau:\n\n\`${code}\`\n\nSau khi đổi xong, hãy nhấn nút **Done** bên dưới.`)
                .setColor(0x5865F2);
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('v_done').setLabel('Done').setStyle(ButtonStyle.Success));
            await i.reply({ embeds: [embed], components: [row], ephemeral: true });
        } catch { await i.reply({ content: "❌ Không tìm thấy Username Roblox này!", ephemeral: true }); }
    }

    if (i.customId === 'v_done') {
        const data = await User.findOne({ discordId: i.user.id });
        const profile = await nblox.getPlayerInfo(parseInt(data.robloxId));
        if (profile.blurb.includes(data.verifyCode)) {
            await i.reply({ content: `✅ Xác minh thành công: **${data.robloxName}**!`, ephemeral: true });
        } else {
            await i.reply({ content: `❌ Không tìm thấy mã! Hãy chắc chắn Bio có chứa: \`${data.verifyCode}\``, ephemeral: true });
        }
    }

    if (i.customId === 'v_unlink') {
        await User.findOneAndDelete({ discordId: i.user.id });
        await i.reply({ content: "🔗 Đã hủy liên kết tài khoản.", ephemeral: true });
    }
});

client.login(process.env.DISCORD_TOKEN);
