/**
 * ==========================================================
 * 🧧 匹諾康尼星際紅包服務 (Lucky Red Packet Service)
 * ==========================================================
 * 核心機制：
 * 1. 無上限塞入星瓊發放拼手氣紅包
 * 2. 經典二倍均值隨機演算法 (Double-Average Algorithm)，每人金額隨機不相等
 * 3. 金額 100% 精準無誤差，每人保底至少 1 星瓊
 * 4. 搶完自動揭曉【👑 手氣最佳 (運氣王)】榜單
 * 5. 立即 deferReply 杜絕 Discord 3 秒逾時「未即時回應」
 * 6. 記憶體 + SQLite 雙層安全鎖，防併發超發與重複領取
 */

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require('discord.js');

const RED_PACKET_COLOR = 0xe74c3c;
const FINISHED_COLOR = 0xf1c40f;

// 進行中的紅包記憶體緩存
// packetId => { id, senderId, senderName, totalJades, totalCount, remainingJades, remainingCount, blessing, claims: [], allocatedAmounts: [], message: DiscordMessage, lock: boolean }
const activeRedPackets = new Map();

/**
 * 初始化紅包資料庫表
 */
function initRedPacketDb(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE IF NOT EXISTS red_packets (
          id TEXT PRIMARY KEY,
          sender_id TEXT NOT NULL,
          sender_name TEXT NOT NULL,
          total_jades INTEGER NOT NULL,
          total_count INTEGER NOT NULL,
          remaining_jades INTEGER NOT NULL,
          remaining_count INTEGER NOT NULL,
          blessing TEXT,
          status TEXT DEFAULT 'ACTIVE',
          channel_id TEXT,
          message_id TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // 自動遷移補齊欄位
      db.run('ALTER TABLE red_packets ADD COLUMN channel_id TEXT', () => {});
      db.run('ALTER TABLE red_packets ADD COLUMN message_id TEXT', () => {});

      db.run(`
        CREATE TABLE IF NOT EXISTS red_packet_claims (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          packet_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          amount INTEGER NOT NULL,
          claimed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(packet_id, user_id)
        )
      `, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

/**
 * 查詢玩家星瓊餘額
 */
function getUserJades(db, userId) {
  return new Promise((resolve) => {
    db.get('SELECT stellarJades FROM user_currency WHERE userId = ?', [userId], (err, row) => {
      resolve(row ? row.stellarJades : 0);
    });
  });
}

/**
 * 扣除玩家星瓊
 */
function deductJades(db, userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades - ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [amount, userId],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

/**
 * 發放星瓊給玩家
 */
function awardJades(db, userId, amount) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE user_currency SET stellarJades = stellarJades + ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?',
      [amount, userId],
      function (err) {
        if (err) return reject(err);
        resolve(this.changes > 0);
      }
    );
  });
}

/**
 * 二倍均值隨機演算法 (Double-Average Algorithm)
 * 瓜分不相等金額，保證總和 100% 等於 totalAmount 且每份至少 1 星瓊
 * @param {number} totalAmount - 總星瓊 (>= count)
 * @param {number} count - 瓜分份數 (>= 1)
 * @returns {number[]} 不相等隨機金額陣列
 */
function generateRandomShares(totalAmount, count) {
  if (count <= 1) return [totalAmount];

  const shares = [];
  let restAmount = totalAmount;
  let restCount = count;

  for (let i = 0; i < count - 1; i++) {
    // 預留後續每人至少 1 星瓊
    const min = 1;
    // 二倍均值上限：2 * (剩餘金額 / 剩餘人數)
    const max = Math.floor((restAmount / restCount) * 2);
    // 安全上限：不能讓後續人分不到 1 星瓊
    const safeMax = Math.min(max, restAmount - (restCount - 1));

    let share = min;
    if (safeMax > min) {
      share = Math.floor(Math.random() * (safeMax - min + 1)) + min;
    }
    shares.push(share);
    restAmount -= share;
    restCount--;
  }
  // 最後一位拿走剩餘所有星瓊，確保總和精確一致
  shares.push(restAmount);

  // Fisher-Yates 隨機洗牌
  for (let i = shares.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shares[i], shares[j]] = [shares[j], shares[i]];
  }

  return shares;
}

/**
 * 構建紅包 Embed
 */
function buildRedPacketEmbed(packet) {
  const isFinished = packet.remainingCount <= 0;
  const isExpired = packet.status === 'EXPIRED';
  const isRefunded = packet.status === 'REFUNDED';

  let title = `🧧【拼手氣星瓊紅包】來自開拓者 ${packet.senderName}`;
  let color = RED_PACKET_COLOR;
  let statusNotice = '👇 點擊下方【🧧 搶紅包】立刻試試手氣！';

  if (isFinished) {
    title = `🎊【紅包已搶完】${packet.senderName} 的拼手氣星瓊紅包已全數瓜分！`;
    color = FINISHED_COLOR;
    statusNotice = '🏆 **本紅包已被群友全數瓜分完畢！** 感謝老闆的大方贊助～';
  } else if (isExpired || isRefunded) {
    title = `⏰【紅包已自動退回】${packet.senderName} 的星瓊紅包已逾 24 小時退回`;
    color = 0x95a5a6;
    statusNotice = '⏳ **本紅包已逾 24 小時未領完，剩餘星瓊已自動全額退還給發起人。**';
  }

  const createdTimeMs = packet.createdAt
    ? new Date(packet.createdAt).getTime()
    : (packet.created_at ? new Date(packet.created_at).getTime() : Date.now());
  const expireTimestamp = Math.floor((createdTimeMs + 24 * 60 * 60 * 1000) / 1000);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(
      `💬 **「${packet.blessing}」**\n\n` +
      `💰 **紅包總額**：**${packet.totalJades.toLocaleString()}** 星瓊\n` +
      `👥 **瓜分人數**：**${packet.totalCount}** 份（隨機拼手氣）\n` +
      `⏳ **剩餘進度**：剩餘 **${packet.remainingCount} / ${packet.totalCount}** 份（**${packet.remainingJades.toLocaleString()}** 星瓊）\n` +
      (!isFinished && !isExpired && !isRefunded ? `⏰ **有效期限**：24 小時（若未領完將於 <t:${expireTimestamp}:R> 自動退還至帳戶）\n\n` : '\n') +
      statusNotice
    )
    .setFooter({ text: '🧧 匹諾康尼星際紅包局 · 拼手氣瓜分星瓊（24小時自動退回）' })
    .setTimestamp();

  if (packet.claims && packet.claims.length > 0) {
    let maxClaimAmount = Math.max(...packet.claims.map((c) => c.amount));
    const claimsText = packet.claims
      .map((c, idx) => {
        const isBest = isFinished && c.amount === maxClaimAmount;
        return `\`#${idx + 1}\` **${c.username}** 搶到了 **${c.amount.toLocaleString()}** 星瓊${isBest ? ' 👑【手氣最佳】' : ''}`;
      })
      .slice(-10) // 顯示最新 10 筆
      .join('\n');

    embed.addFields({
      name: `📋 已領取群友 (${packet.claims.length}/${packet.totalCount})`,
      value: claimsText || '暫無',
      inline: false,
    });
  }

  return embed;
}

/**
 * 構建紅包按鈕 Row (取消手動退回按鈕，僅保留搶紅包)
 */
function buildRedPacketRow(packet) {
  const isFinished = packet.remainingCount <= 0 || packet.status === 'EXPIRED' || packet.status === 'REFUNDED';
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`redpacket_grab_${packet.id}`)
      .setLabel(isFinished ? '🧧 紅包已結束' : '🧧 搶紅包')
      .setStyle(isFinished ? ButtonStyle.Secondary : ButtonStyle.Danger)
      .setDisabled(isFinished)
  );
}

/**
 * 處理發送拼手氣紅包 Slash Command: /紅包
 */
async function handleSendRedPacket(db, interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const totalJades = interaction.options.getInteger('總星瓊');
  const count = interaction.options.getInteger('份數');
  const blessing = interaction.options.getString('祝福語') || '恭喜發財，大吉大利！';

  // 1. 基礎防呆驗證
  if (!totalJades || totalJades < 1) {
    return interaction.reply({
      content: '❌ **紅包星瓊總額必須大於等於 1！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!count || count < 1 || count > 100) {
    return interaction.reply({
      content: '❌ **紅包份數必須在 1 到 100 之間！**',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (totalJades < count) {
    return interaction.reply({
      content: `❌ **星瓊總額不足以瓜分！** ${count} 份紅包每人至少分 1 星瓊，總額需至少為 **${count}** 星瓊。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 2. 檢查發起人星瓊餘額
  const currentJades = await getUserJades(db, userId);
  if (currentJades < totalJades) {
    return interaction.reply({
      content: `❌ **星瓊餘額不足！** 你目前擁有 **${currentJades.toLocaleString()}** 星瓊，無法發送 **${totalJades.toLocaleString()}** 星瓊的紅包。`,
      flags: MessageFlags.Ephemeral,
    });
  }

  // 3. 扣除發起人星瓊
  await deductJades(db, userId, totalJades);

  // 4. 隨機生成不相等瓜分份額
  const allocatedAmounts = generateRandomShares(totalJades, count);
  const packetId = `rp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  const packet = {
    id: packetId,
    senderId: userId,
    senderName: username,
    totalJades,
    totalCount: count,
    remainingJades: totalJades,
    remainingCount: count,
    blessing,
    claims: [],
    allocatedAmounts,
    lock: false,
    message: null,
    channelId: null,
    messageId: null,
    createdAt: new Date().toISOString(),
  };

  // 5. 發送紅包訊息到頻道
  const embed = buildRedPacketEmbed(packet);
  const row = buildRedPacketRow(packet);

  const msg = await interaction.reply({
    embeds: [embed],
    components: [row],
    fetchReply: true,
  });

  const channelId = interaction.channelId || (interaction.channel ? interaction.channel.id : null);
  const messageId = msg ? msg.id : null;

  packet.message = msg;
  packet.channelId = channelId;
  packet.messageId = messageId;

  // 6. 寫入資料庫記錄 (含 channel_id 與 message_id 支援 24 小時逾期自動退回)
  db.run(
    `INSERT INTO red_packets (id, sender_id, sender_name, total_jades, total_count, remaining_jades, remaining_count, blessing, status, channel_id, message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
    [packetId, userId, username, totalJades, count, totalJades, count, blessing, channelId, messageId],
    (err) => {
      if (err) console.error('❌ 寫入紅包資料庫記錄失敗:', err);
    }
  );

  activeRedPackets.set(packetId, packet);
}

/**
 * 處理群友點擊【🧧 搶紅包】
 */
async function handleGrabRedPacket(db, interaction, packetId) {
  // ⚡ 核心修復：第一時間 deferReply 立即向 Discord 回應 ACK，杜絕 3 秒逾時與「未即時回應」
  if (typeof interaction.deferReply === 'function') await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

  const sendResponse = async (text) => {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: text }).catch(() => {});
    } else {
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  };

  let packet = activeRedPackets.get(packetId);

  // 若記憶體中無資料，嘗試從資料庫還原
  if (!packet) {
    const dbPacket = await new Promise((resolve) => {
      db.get('SELECT * FROM red_packets WHERE id = ?', [packetId], (err, row) => resolve(row));
    });

    if (!dbPacket || dbPacket.status !== 'ACTIVE' || dbPacket.remaining_count <= 0) {
      return sendResponse('❌ **該紅包已經全數被瓜分完畢或已結束！**');
    }

    // 查詢歷史已領取記錄
    const existingClaims = await new Promise((resolve) => {
      db.all(
        'SELECT user_id as userId, username, amount, strftime("%s", claimed_at) * 1000 as claimedAt FROM red_packet_claims WHERE packet_id = ? ORDER BY id ASC',
        [packetId],
        (err, rows) => resolve(rows || [])
      );
    });

    // 還原記憶體物件
    packet = {
      id: dbPacket.id,
      senderId: dbPacket.sender_id,
      senderName: dbPacket.sender_name,
      totalJades: dbPacket.total_jades,
      totalCount: dbPacket.total_count,
      remainingJades: dbPacket.remaining_jades,
      remainingCount: dbPacket.remaining_count,
      blessing: dbPacket.blessing,
      claims: existingClaims,
      allocatedAmounts: generateRandomShares(dbPacket.remaining_jades, dbPacket.remaining_count),
      lock: false,
      message: interaction.message,
      channelId: dbPacket.channel_id,
      messageId: dbPacket.message_id,
      createdAt: dbPacket.created_at,
    };
    activeRedPackets.set(packetId, packet);
  }

  // 檢查是否已逾期 24 小時
  const createdAtMs = new Date(packet.createdAt || Date.now()).getTime();
  if (createdAtMs && Date.now() - createdAtMs >= 24 * 60 * 60 * 1000) {
    return sendResponse('❌ **該紅包已逾 24 小時有效時限，剩餘星瓊已自動退還至發起人！**');
  }

  const userId = interaction.user.id;
  const username = interaction.user.username;

  // 1. 檢查是否已經搶過
  const alreadyClaimed = packet.claims.find((c) => c.userId === userId);
  if (alreadyClaimed) {
    return sendResponse(`⚠️ **你已經搶過這個紅包囉！** 搶到了 **${alreadyClaimed.amount.toLocaleString()}** 星瓊。`);
  }

  // 雙重檢查資料庫是否已領過
  const dbClaim = await new Promise((resolve) => {
    db.get('SELECT amount FROM red_packet_claims WHERE packet_id = ? AND user_id = ?', [packetId, userId], (err, row) => resolve(row));
  });
  if (dbClaim) {
    return sendResponse(`⚠️ **你已經搶過這個紅包囉！** 搶到了 **${dbClaim.amount.toLocaleString()}** 星瓊。`);
  }

  // 2. 檢查紅包是否已搶完
  if (packet.remainingCount <= 0 || packet.allocatedAmounts.length === 0) {
    return sendResponse('😢 **手慢了一步！紅包已經被全數瓜分完畢囉～**');
  }

  // 3. 併發防刷保護 (簡易鎖)
  if (packet.lock) {
    return sendResponse('⏳ **伺服器正在處理前一位開拓者的紅包，請稍候再點一次！**');
  }
  packet.lock = true;

  try {
    // 4. 取出一份金額並發放
    const grabAmount = packet.allocatedAmounts.pop();
    packet.remainingCount--;
    packet.remainingJades -= grabAmount;

    const claimRecord = {
      userId,
      username,
      amount: grabAmount,
      claimedAt: Date.now(),
    };
    packet.claims.push(claimRecord);

    // 發放星瓊入帳
    await awardJades(db, userId, grabAmount);

    // 寫入資料庫
    db.run(
      'INSERT INTO red_packet_claims (packet_id, user_id, username, amount) VALUES (?, ?, ?, ?)',
      [packetId, userId, username, grabAmount],
      (err) => {
        if (err) console.error('❌ 寫入領取紅包記錄失敗:', err);
      }
    );

    const isFinished = packet.remainingCount <= 0;
    const newStatus = isFinished ? 'FINISHED' : 'ACTIVE';
    await new Promise((resolve) => {
      db.run(
        'UPDATE red_packets SET remaining_jades = ?, remaining_count = ?, status = ? WHERE id = ?',
        [packet.remainingJades, packet.remainingCount, newStatus, packetId],
        () => resolve()
      );
    });

    // 5. 回覆搶到者
    await sendResponse(`🎉 **手氣爆棚！** 恭喜你搶到了 **${grabAmount.toLocaleString()}** 星瓊！已即時存入你的帳戶。`);

    // 6. 更新紅包主訊息 Embed
    const targetMsg = packet.message || interaction.message;
    if (targetMsg && typeof targetMsg.edit === 'function') {
      const updatedEmbed = buildRedPacketEmbed(packet);
      const updatedRow = buildRedPacketRow(packet);
      await targetMsg.edit({
        embeds: [updatedEmbed],
        components: [updatedRow],
      }).catch((editErr) => console.warn('⚠️ 更新紅包訊息失敗:', editErr.message));
    }

    // 7. 若剛好搶完最後一份，在頻道廣播運氣王
    if (isFinished) {
      let maxClaimAmount = Math.max(...packet.claims.map((c) => c.amount));
      const luckyKing = packet.claims.find((c) => c.amount === maxClaimAmount);
      if (luckyKing && interaction.channel) {
        await interaction.channel.send({
          content: `🎊 **【紅包搶完囉】** 開拓者 **${packet.senderName}** 的星瓊紅包已全數瓜分！\n` +
            `👑 恭喜 **${luckyKing.username}** 榮獲本期 **手氣最佳 (運氣王)**，獨得 **+${luckyKing.amount.toLocaleString()}** 星瓊！`,
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('❌ 處理搶紅包流程異常:', err);
    await sendResponse('⚠️ 處理搶紅包過程遭遇微小網絡波動，請稍後重試。');
  } finally {
    packet.lock = false;
  }
}


/**
 * 處理撤回/退回紅包 (支援 Slash Command、文字指令與按鈕回退)
 */
async function handleRefundRedPacket(db, interaction, targetPacketId = null) {
  const userId = interaction.user ? interaction.user.id : interaction.author.id;
  const username = interaction.user ? interaction.user.username : interaction.author.username;

  let packetRow;
  if (targetPacketId) {
    packetRow = await new Promise((resolve) => {
      db.get('SELECT * FROM red_packets WHERE id = ?', [targetPacketId], (_, row) => resolve(row));
    });
  } else {
    // 查詢該使用者最近發送且狀態為 ACTIVE 的紅包
    packetRow = await new Promise((resolve) => {
      db.get(
        "SELECT * FROM red_packets WHERE sender_id = ? AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 1",
        [userId],
        (_, row) => resolve(row)
      );
    });
  }

  const sendResp = async (content, ephemeral = true) => {
    if (interaction.reply && typeof interaction.reply === 'function') {
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content }).catch(() => {});
      }
      return interaction.reply({ content, flags: ephemeral ? MessageFlags.Ephemeral : undefined }).catch(() => {});
    }
    if (interaction.channel && typeof interaction.channel.send === 'function') {
      return interaction.channel.send(content).catch(() => {});
    }
  };

  if (!packetRow) {
    return sendResp('❌ **找不到進行中可撤回的星瓊紅包！** (可能已被搶完或已撤回)');
  }

  if (packetRow.sender_id !== userId && username !== 'lance_508') {
    return sendResp('❌ **只有紅包發起人（或主理人 lance_508）才能撤回此紅包！**');
  }

  if (packetRow.status !== 'ACTIVE' || packetRow.remaining_jades <= 0) {
    return sendResp('❌ **該紅包已結束或已被全額領取完畢，無法退回！**');
  }

  // ⏰ 核心約束：紅包必須滿 24 小時才能退回 (主理人 lance_508 可緊急處置除外)
  const createdAtMs = new Date(packetRow.created_at).getTime();
  const elapsedMs = Date.now() - createdAtMs;
  const twentyFourHoursMs = 24 * 60 * 60 * 1000;

  if (elapsedMs < twentyFourHoursMs && username !== 'lance_508') {
    const expireTimestamp = Math.floor((createdAtMs + twentyFourHoursMs) / 1000);
    return sendResp(
      `❌ **紅包無法手動提早退回！**\n` +
      `星瓊紅包已設為發出滿 24 小時由系統自動結算退回，目前仍在群友瓜分期（預計 <t:${expireTimestamp}:R> 自動結算退還）。`
    );
  }

  const refundJades = packetRow.remaining_jades;
  const senderId = packetRow.sender_id;

  // 1. 將剩餘星瓊原路退回發送者帳戶
  await awardJades(db, senderId, refundJades);

  // 2. 更新資料庫狀態
  await new Promise((resolve) => {
    db.run(
      "UPDATE red_packets SET status = 'REFUNDED', remaining_jades = 0, remaining_count = 0 WHERE id = ?",
      [packetRow.id],
      () => resolve()
    );
  });

  // 3. 移除記憶體快取
  const memPacket = activeRedPackets.get(packetRow.id);
  activeRedPackets.delete(packetRow.id);

  // 4. 更新 Discord 上的紅包訊息
  const targetMsg = (memPacket && memPacket.message) || interaction.message;
  if (targetMsg && typeof targetMsg.edit === 'function') {
    const refundEmbed = new EmbedBuilder()
      .setTitle(`⏰【紅包已退回】${packetRow.sender_name} 的星瓊紅包已結算退回`)
      .setColor(0x95a5a6)
      .setDescription(
        `💬 **「${packetRow.blessing}」**\n\n` +
        `💰 **原紅包總額**：**${packetRow.total_jades.toLocaleString()}** 星瓊\n` +
        `↩️ **已退回星瓊**：**${refundJades.toLocaleString()}** 星瓊 (全額退回至發起人帳戶)\n` +
        `👥 **發放份數**：原 ${packetRow.total_count} 份 (已發出 ${packetRow.total_count - packetRow.remaining_count} 份)`
      )
      .setFooter({ text: '🧧 匹諾康尼星際紅包局 · 紅包退回結案' })
      .setTimestamp();

    await targetMsg.edit({
      embeds: [refundEmbed],
      components: [],
    }).catch(() => {});
  }

  // 5. 在頻道中發布公開退回通知
  if (interaction.channel && typeof interaction.channel.send === 'function') {
    await interaction.channel.send({
      content: `⏰ **【紅包退回通知】**\n` +
        `開拓者 <@${packetRow.sender_id}>（**${packetRow.sender_name}**）發起的星瓊紅包已結算退回！\n` +
        `💰 剩餘的 **${refundJades.toLocaleString()}** 星瓊已全額原路退還至開拓者帳戶！`,
    }).catch(() => {});
  }

  return sendResp(
    `✅ **已成功撤回紅包！**\n💰 剩餘的 **${refundJades.toLocaleString()}** 星瓊已全額原路退還至發起人帳戶！目前狀態已結案。`
  );
}

/**
 * 檢查並自動退回已逾 24 小時之未領完紅包，並於原頻道發送通知
 */
async function checkAndRefundExpiredPackets(client, db) {
  if (!db) return [];

  return new Promise((resolve) => {
    db.all(
      `SELECT * FROM red_packets 
       WHERE status = 'ACTIVE' 
         AND remaining_jades > 0 
         AND datetime(created_at, '+24 hours') <= datetime('now')`,
      async (err, rows) => {
        if (err) {
          console.error('❌ 查詢逾期紅包失敗:', err);
          return resolve([]);
        }

        const expiredPackets = rows || [];
        const processed = [];

        for (const packetRow of expiredPackets) {
          try {
            const refundJades = packetRow.remaining_jades;
            const senderId = packetRow.sender_id;

            // 1. 將剩餘星瓊原路退回發送者帳戶
            await awardJades(db, senderId, refundJades);

            // 2. 更新資料庫狀態為 EXPIRED
            await new Promise((r) => {
              db.run(
                "UPDATE red_packets SET status = 'EXPIRED', remaining_jades = 0, remaining_count = 0 WHERE id = ?",
                [packetRow.id],
                () => r()
              );
            });

            // 3. 移除記憶體快取
            activeRedPackets.delete(packetRow.id);
            processed.push(packetRow);

            console.log(`⏰ [紅包自動退回] 紅包 ${packetRow.id} (發起人: ${packetRow.sender_name}) 已滿 24 小時，自動退還 ${refundJades.toLocaleString()} 星瓊！`);

            // 4. 更新 Discord 訊息並於頻道發送退回通知
            if (client && packetRow.channel_id) {
              try {
                const channel = await client.channels.fetch(packetRow.channel_id).catch(() => null);
                if (channel) {
                  // 更新原始紅包訊息
                  if (packetRow.message_id) {
                    const targetMsg = await channel.messages.fetch(packetRow.message_id).catch(() => null);
                    if (targetMsg) {
                      const expiredEmbed = new EmbedBuilder()
                        .setTitle(`⏰【紅包已逾期退回】${packetRow.sender_name} 的星瓊紅包已逾 24 小時`)
                        .setColor(0x95a5a6)
                        .setDescription(
                          `💬 **「${packetRow.blessing}」**\n\n` +
                          `💰 **原紅包總額**：**${packetRow.total_jades.toLocaleString()}** 星瓊\n` +
                          `↩️ **自動退回星瓊**：**${refundJades.toLocaleString()}** 星瓊 (已全額退回至發起人帳戶)\n` +
                          `👥 **發放狀況**：原 ${packetRow.total_count} 份（已瓜分 ${packetRow.total_count - packetRow.remaining_count} 份，剩餘 ${packetRow.remaining_count} 份逾期自動回收）`
                        )
                        .setFooter({ text: '🧧 匹諾康尼星際紅包局 · 24 小時逾期自動退回結案' })
                        .setTimestamp();

                      await targetMsg.edit({
                        embeds: [expiredEmbed],
                        components: [], // 移除按鈕
                      }).catch(() => {});
                    }
                  }

                  // 5. 在頻道發布公開退回通知
                  await channel.send({
                    content: `⏰ **【紅包逾期自動退回通知】**\n` +
                      `開拓者 <@${packetRow.sender_id}>（**${packetRow.sender_name}**）發起的星瓊紅包已滿 24 小時！\n` +
                      `💰 未領取完畢的剩餘 **${refundJades.toLocaleString()}** 星瓊已全額自動原路退還至開拓者帳戶！`,
                  }).catch(() => {});
                }
              } catch (discordErr) {
                console.warn('⚠️ 更新逾期紅包訊息或發送通知失敗:', discordErr.message);
              }
            }
          } catch (itemErr) {
            console.error(`❌ 自動退回紅包 ${packetRow.id} 發生異常:`, itemErr);
          }
        }

        resolve(processed);
      }
    );
  });
}

let redPacketSchedulerInterval = null;

/**
 * 啟動紅包 24 小時逾期定時巡檢排程
 */
function startRedPacketAutoRefundScheduler(client, db) {
  if (redPacketSchedulerInterval) clearInterval(redPacketSchedulerInterval);

  // 開機立即檢測一次
  checkAndRefundExpiredPackets(client, db).catch((err) => {
    console.error('❌ 啟動檢查逾期紅包失敗:', err);
  });

  // 每 60 秒定期巡檢
  redPacketSchedulerInterval = setInterval(() => {
    checkAndRefundExpiredPackets(client, db).catch((err) => {
      console.error('❌ 定期檢查逾期紅包失敗:', err);
    });
  }, 60 * 1000);

  if (redPacketSchedulerInterval.unref) {
    redPacketSchedulerInterval.unref();
  }
}

module.exports = {
  initRedPacketDb,
  generateRandomShares,
  handleSendRedPacket,
  handleGrabRedPacket,
  handleRefundRedPacket,
  checkAndRefundExpiredPackets,
  startRedPacketAutoRefundScheduler,
  activeRedPackets,
  buildRedPacketRow,
  buildRedPacketEmbed,
};
