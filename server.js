const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static('public')); // Статические файлы (виджет)

// Инициализация Telegram бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Хранилище сообщений от клиентов (ожидают ответа)
// Формат: { id: { message, timestamp, openlineCode, url } }
const pendingMessages = new Map();
let messageCounter = 0;

// Хранилище связей между сессиями и Telegram чатами
// Формат: { sessionKey: telegramChatId }
const sessionMapping = new Map();

// Обработка сообщений от виджета на сайте
app.post('/api/message', async (req, res) => {
	try {
		const { message, type, openlineCode, url } = req.body;

		if (!message || !message.trim()) {
			return res.status(400).json({ error: 'Сообщение пустое' });
		}

		// Создаем ключ сессии на основе URL и кода открытой линии
		const sessionKey = `${openlineCode || 'default'}_${url}`;
		
		// Получаем или создаем связь с Telegram чатом
		let telegramChatId = sessionMapping.get(sessionKey);

		if (!telegramChatId) {
			// Используем чат администратора для новых сессий
			telegramChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
			sessionMapping.set(sessionKey, telegramChatId);
		}

		// Сохраняем сообщение для ответа
		const messageId = ++messageCounter;
		pendingMessages.set(messageId, {
			id: messageId,
			message: message,
			timestamp: new Date().toISOString(),
			openlineCode: openlineCode,
			url: url,
			sessionKey: sessionKey,
			telegramChatId: telegramChatId
		});

		// Отправляем сообщение в Telegram
		const messageText = type === 'client' 
			? `📨 Сообщение от клиента:\n\n${message}\n\n💬 Ответьте на это сообщение, чтобы отправить ответ клиенту.`
			: `📨 Сообщение:\n\n${message}`;

		const sentMessage = await bot.sendMessage(telegramChatId, messageText, {
			reply_markup: {
				inline_keyboard: [[
					{ text: 'Ответить', callback_data: `reply_${messageId}` }
				]]
			}
		});

		// Сохраняем ID сообщения Telegram для связи
		const msgData = pendingMessages.get(messageId);
		msgData.telegramMessageId = sentMessage.message_id;

		res.status(200).json({ 
			result: true, 
			messageId: messageId 
		});

		console.log(`Сообщение от клиента получено и отправлено в Telegram: ${telegramChatId}`);
	} catch (error) {
		console.error('Ошибка обработки сообщения:', error);
		res.status(500).json({ error: error.message });
	}
});

// Обработка ответов из Telegram (ответ на сообщение)
bot.on('message', async (msg) => {
	try {
		// Пропускаем команды бота
		if (msg.text && msg.text.startsWith('/')) {
			return;
		}

		// Проверяем, является ли это ответом на сообщение
		if (msg.reply_to_message) {
			const repliedMessageId = msg.reply_to_message.message_id;
			
			// Ищем сообщение в хранилище по ID сообщения Telegram
			let targetMessage = null;
			for (const [id, data] of pendingMessages.entries()) {
				if (data.telegramMessageId === repliedMessageId) {
					targetMessage = data;
					break;
				}
			}

			if (targetMessage) {
				// Сохраняем ответ для отправки клиенту
				const responseId = ++messageCounter;
				pendingMessages.set(responseId, {
					id: responseId,
					message: msg.text,
					timestamp: new Date().toISOString(),
					sessionKey: targetMessage.sessionKey,
					telegramChatId: msg.chat.id.toString(),
					isResponse: true,
					originalMessageId: targetMessage.id
				});

				await bot.sendMessage(msg.chat.id, '✅ Ответ сохранен и будет отправлен клиенту');
				console.log(`Ответ сохранен для отправки клиенту: ${targetMessage.sessionKey}`);
			}
		}
	} catch (error) {
		console.error('Ошибка обработки ответа из Telegram:', error);
	}
});

// Получение ожидающих ответов сообщений (для виджета)
app.get('/api/messages/pending', (req, res) => {
	try {
		const messages = Array.from(pendingMessages.values())
			.filter(msg => msg.isResponse)
			.map(msg => ({
				id: msg.id,
				text: msg.message,
				timestamp: msg.timestamp
			}));

		res.status(200).json({ messages });
	} catch (error) {
		console.error('Ошибка получения сообщений:', error);
		res.status(500).json({ error: error.message });
	}
});

// Подтверждение получения сообщений (удаление из очереди)
app.post('/api/messages/confirm', (req, res) => {
	try {
		const { ids } = req.body;

		if (Array.isArray(ids)) {
			ids.forEach(id => {
				pendingMessages.delete(id);
			});
		}

		res.status(200).json({ result: true });
	} catch (error) {
		console.error('Ошибка подтверждения сообщений:', error);
		res.status(500).json({ error: error.message });
	}
});

// Команда для получения информации о боте
bot.onText(/\/start/, (msg) => {
	bot.sendMessage(
		msg.chat.id,
		'🤖 Бот для интеграции с Битрикс24\n\n' +
		'Бот готов к работе.\n\n' +
		'📨 Сообщения от клиентов из открытой линии будут пересылаться сюда.\n' +
		'💬 Чтобы ответить клиенту, ответьте на его сообщение (Reply).\n\n' +
		'Ваш чат ID: ' + msg.chat.id
	);
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Сервер запущен на порту ${PORT}`);
	console.log(`Виджет доступен по адресу: http://localhost:${PORT}/widget.js`);
	console.log(`API для виджета: http://localhost:${PORT}/api/message`);
});

