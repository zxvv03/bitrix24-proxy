// Виджет для перехвата сообщений открытой линии Битрикс24
// Встраивается на сайт вместе с виджетом открытой линии

(function() {
	'use strict';

	// Настройки
	const config = {
		serverUrl: window.BITRIX_TG_BRIDGE_URL || 'http://localhost:3000',
		openlineCode: window.BITRIX_OPENLINE_CODE || null
	};

	// Ожидание загрузки виджета Битрикс24
	function waitForBitrixWidget(callback, maxAttempts = 50) {
		let attempts = 0;
		const checkInterval = setInterval(() => {
			attempts++;
			
			// Проверяем наличие виджета открытой линии
			const widget = document.querySelector('[data-bx-widget]') || 
			               document.querySelector('.bx-messenger') ||
			               window.BX;
			
			if (widget || attempts >= maxAttempts) {
				clearInterval(checkInterval);
				if (widget) {
					callback(widget);
				} else {
					console.warn('Виджет Битрикс24 не найден');
				}
			}
		}, 500);
	}

	// Перехват отправки сообщений
	function interceptMessages() {
		// Слушаем клики по кнопке отправки
		document.addEventListener('click', function(e) {
			const sendButton = e.target.closest('[data-bx-send-button], .bx-messenger-textarea-send, button[type="submit"]');
			
			if (sendButton) {
				// Ищем поле ввода сообщения
				const textarea = document.querySelector('[data-bx-textarea], .bx-messenger-textarea-input, textarea');
				
				if (textarea && textarea.value.trim()) {
					const message = textarea.value.trim();
					
					// Отправляем сообщение на наш сервер
					sendToBridge(message);
				}
			}
		});

		// Слушаем нажатие Enter
		document.addEventListener('keydown', function(e) {
			if (e.key === 'Enter' && !e.shiftKey) {
				const textarea = document.querySelector('[data-bx-textarea], .bx-messenger-textarea-input, textarea');
				
				if (textarea && document.activeElement === textarea && textarea.value.trim()) {
					const message = textarea.value.trim();
					sendToBridge(message);
				}
			}
		});

		// Перехватываем новые сообщения в чате
		observeNewMessages();
	}

	// Наблюдение за новыми сообщениями в чате
	function observeNewMessages() {
		const chatContainer = document.querySelector('.bx-messenger-content, .bx-messenger-dialog');
		
		if (!chatContainer) {
			setTimeout(observeNewMessages, 1000);
			return;
		}

		const observer = new MutationObserver(function(mutations) {
			mutations.forEach(function(mutation) {
				mutation.addedNodes.forEach(function(node) {
					if (node.nodeType === 1) {
						const messageElement = node.querySelector && node.querySelector('.bx-messenger-content-item-message-text, .bx-messenger-content-item-text');
						
						if (messageElement) {
							const messageText = messageElement.textContent || messageElement.innerText;
							
							// Проверяем, что это сообщение от клиента (не от оператора)
							const isClientMessage = !node.querySelector('.bx-messenger-content-item-own');
							
							if (isClientMessage && messageText.trim()) {
								sendToBridge(messageText.trim(), 'client');
							}
						}
					}
				});
			});
		});

		observer.observe(chatContainer, {
			childList: true,
			subtree: true
		});
	}

	// Отправка сообщения на сервер-мост
	function sendToBridge(message, type = 'client') {
		fetch(`${config.serverUrl}/api/message`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				message: message,
				type: type,
				openlineCode: config.openlineCode,
				timestamp: new Date().toISOString(),
				url: window.location.href
			})
		}).catch(err => {
			console.error('Ошибка отправки сообщения на сервер:', err);
		});
	}

	// Получение ответов из Telegram и вставка в чат
	function receiveTelegramMessages() {
		// Опрашиваем сервер на наличие новых сообщений
		setInterval(async () => {
			try {
				const response = await fetch(`${config.serverUrl}/api/messages/pending`, {
					method: 'GET',
					headers: {
						'Content-Type': 'application/json'
					}
				});

				if (response.ok) {
					const data = await response.json();
					
					if (data.messages && data.messages.length > 0) {
						data.messages.forEach(msg => {
							insertMessageToChat(msg.text);
						});
						
						// Подтверждаем получение
						await fetch(`${config.serverUrl}/api/messages/confirm`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json'
							},
							body: JSON.stringify({ ids: data.messages.map(m => m.id) })
						});
					}
				}
			} catch (err) {
				// Тихая ошибка, чтобы не засорять консоль
			}
		}, 2000); // Проверяем каждые 2 секунды
	}

	// Вставка сообщения в чат Битрикс24
	function insertMessageToChat(text) {
		const textarea = document.querySelector('[data-bx-textarea], .bx-messenger-textarea-input, textarea');
		
		if (textarea) {
			textarea.value = text;
			textarea.dispatchEvent(new Event('input', { bubbles: true }));
			
			// Отправляем сообщение
			setTimeout(() => {
				const sendButton = document.querySelector('[data-bx-send-button], .bx-messenger-textarea-send, button[type="submit"]');
				if (sendButton) {
					sendButton.click();
				}
			}, 100);
		}
	}

	// Инициализация
	waitForBitrixWidget(function() {
		console.log('Виджет Битрикс24 найден, инициализация перехвата сообщений...');
		interceptMessages();
		receiveTelegramMessages();
	});

})();

