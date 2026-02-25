const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, InteractionType } = require('discord.js');
const mongoose = require('mongoose');
const nblox = require('noblox.js');
require('dotenv').config();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers]
});

// Kết nối Cơ sở dữ liệu
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✅ Đã kết nối MongoDB"))
    .catch(err => console.error("❌ Lỗi DB:", err));

// Cấu trúc dữ liệu người chơi
const User = mongoose.model('User', new mongoose.Schema({
    discordId: String,
    robloxId: String,
    robloxName: String,
    elo: { type: Number, default: 1000 },
    wins: { type: Number, default: 0 },
    losses: { type: Number, default: 0 }
}));

// Hàm lấy tên Rank dựa trên ELO
const getRankInfo = (elo) => {
    if (elo >= 1500) return { name: "Surge", color: 0xFF0000 };
    if (elo >= 1200) return { name: "Trace", color: 0x00FF00 };
    return { name: "Unranked", color: 0xAAAAAA };
};

client.on('ready', () => {
    console.log(`🤖 Bot ${client.user.tag} đã sẵn sàng!`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const args = message.content.split(' ');

    // Lệnh 1: Setup bảng Verify (Giống ảnh 4)
    if (message.content === '!setup-verify' && message.member.permissions.has('Administrator')) {
        const embed = new EmbedBuilder()
            .setTitle("🔒 PrimeBlox — Account Verification")
            .setDescription("Link your Discord account to your Roblox profile to participate in competitive matches.")
            .setColor(0xFFAA00);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('verify_start').setLabel('Verify Account').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('unlink').setLabel('Unlink Account').setStyle(ButtonStyle.Danger)
        );

        message.channel.send({ embeds: [embed], components: [row] });
    }

    // Lệnh 2: Xem Stats (Giống ảnh 2, 3)
    if (args[0] === '!stats') {
        const target = message.mentions.users.first() || message.author;
        const data = await User.findOne({ discordId: target.id });

        if (!data) return message.reply("Người dùng này chưa xác minh!");

        const rank = getRankInfo(data.elo);
        const statsEmbed = new EmbedBuilder()
            .setAuthor({ name: `${data.robloxName}'s Statistics`, iconURL: target.displayAvatarURL() })
            .setColor(rank.color)
            .addFields(
                { name: '🏆 Rank', value: `${rank.name} (${data.elo} ELO)`, inline: true },
                { name: '📊 Win Rate', value: `${((data.wins / (data.wins + data.losses || 1)) * 100).toFixed(1)}%`, inline: true },
                { name: '🎮 Matches', value: `${data.wins + data.losses}`, inline: true }
            )
            .setFooter({ text: `Wins: ${data.wins} | Losses: ${data.losses}` });

        message.reply({ embeds: [statsEmbed] });
    }

    // Lệnh 3: !win (Cập nhật kết quả hàng loạt - Giống ảnh 1)
    if (args[0] === '!win' && message.member.permissions.has('Administrator')) {
        const winTeam = args[1]?.toUpperCase(); // CT hoặc T
        const score = args[2]; // 16-14
        const mentions = message.mentions.users.toJSON();

        if (mentions.length < 10) return message.reply("Vui lòng tag đủ 10 người (5 CT đầu, 5 T sau)!");

        let ctResults = "";
        let tResults = "";

        for (let i = 0; i < mentions.length; i++) {
            const isCT = i < 5;
            const won = (winTeam === 'CT' && isCT) || (winTeam === 'T' && !isCT);
            const eloAdd = won ? 25 : -20;

            const updated = await User.findOneAndUpdate(
                { discordId: mentions[i].id },
                { $inc: { elo: eloAdd, wins: won ? 1 : 0, losses: won ? 0 : 1 } },
                { upsert: true, new: true }
            );

            const line = `• ${updated.robloxName || mentions[i].username}: **${eloAdd > 0 ? '+' : ''}${eloAdd}**\n`;
            if (isCT) ctResults += line; else tResults += line;
        }

        const matchEmbed = new EmbedBuilder()
            .setTitle("MATCH ENDED")
            .setDescription(`## ${score}\n**MAP: MIRAGE**`)
            .addFields(
                { name: '🟦 COUNTER-TERRORISTS', value: ctResults, inline: true },
                { name: '🟥 TERRORISTS', value: tResults, inline: true }
            )
            .setColor(winTeam === 'CT' ? 0x00AAFF : 0xFF4444);

        message.channel.send({ embeds: [matchEmbed] });
    }
});

// Xử lý nút bấm và Modal (Nhập tên Roblox)
client.on('interactionCreate', async (interaction) => {
    if (interaction.customId === 'verify_start') {
        const modal = new ModalBuilder().setCustomId('v_modal').setTitle('Account Verification');
        const input = new TextInputBuilder().setCustomId('rbx_user').setLabel("Nhập tên Roblox của bạn").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        await interaction.showModal(modal);
    }

    if (interaction.type === InteractionType.ModalSubmit && interaction.customId === 'v_modal') {
        const rbxName = interaction.fields.getTextInputValue('rbx_user');
        try {
            const rbxId = await nblox.getIdFromUsername(rbxName);
            await User.findOneAndUpdate({ discordId: interaction.user.id }, { robloxName: rbxName, robloxId: rbxId.toString() }, { upsert: true });
            await interaction.reply({ content: `✅ Đã xác minh thành công: **${rbxName}**`, ephemeral: true });
        } catch {
            await interaction.reply({ content: "❌ Không tìm thấy tên Roblox này!", ephemeral: true });
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
