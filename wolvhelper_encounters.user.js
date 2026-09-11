// ==UserScript==
// @name        Wolvhelper: Explore Encounters
// @namespace   https://github.com/Kaztaztrophe/Wolvhelper/
// @version     1.2.1
// @author      Kaztaztrophe
// @description Wolvden explore encounter helper which displays results
// @match       https://www.wolvden.com/*
// @match       https://wolvden.com/*
// @run-at      document-idle
// @grant       none
// @noframes
// @updateURL   https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelper_encounters.user.js
// @downloadURL https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/wolvhelper_encounters.user.js
// ==/UserScript==

(function () {
	'use strict';

	// Script settings and variables
	const DATABASE_URL = 'https://raw.githubusercontent.com/Kaztaztrophe/Wolvhelper/main/encounters.json';
	const HELPER_CLASS = 'explore-helper';
	const HELPER_MARGINS = '10px';
	const IMAGE_WIDTH = '25px';
	const IMAGE_HEIGHT = '25px';
	const LINE_HEIGHT = '25px';
	const WAIT_TIMEOUT = 10000;

	// Import encounter.json database and pre-build
	let database = null;
	let encounterIdLookup = [];

	// Load encounter database
	async function loadDatabase() {
		try {
			const response = await fetch(DATABASE_URL);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			database = await response.json();

			if (!database.encounters || typeof database.encounters !== 'object') {
				throw new Error('Database is missing "encounters"');
			}

			// Build the encounter lookup
			encounterIdLookup =
				Object.keys(database.encounters)
					.map(id => ({
						id: id,
						normalized: id.toLowerCase()
					}))
					// Load longest first to prevent incorrect results
					.sort(
						(a, b) =>
							b.normalized.length -
							a.normalized.length
					);

			updateExploreOutput();

		} catch (error) {
			console.error('[Wolvhelper] Failed to load database:', error);
		}
	}

	// Normalize the text
	function normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/\*/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[!?.,:]+$/, '');
	}

	// Find encounter ID from data-action button
	function findEncounterIdFromAction(action) {
    if (!action || encounterIdLookup.length === 0) {
      return null;
    }

    const normalizedAction = action.toLowerCase();

    for (const entry of encounterIdLookup) {

      // Standard encounters
      if (normalizedAction.includes(entry.normalized)) {
        return entry.id;
      }

      // Filler encounters
      if (entry.normalized.startsWith('filler')) {
        const fillerActionName = 'filler_' + entry.normalized.slice(6);

        if (normalizedAction.includes(fillerActionName)) {
          return entry.id;
        }
      }
    }

    return null;
	}

	function findEncounterByButton(output) {
		const buttons = output.querySelectorAll('button');

		for (const button of buttons) {
			const action = button.dataset.action;
			const id = findEncounterIdFromAction(action);
			if (id && database.encounters[id]) {
				return {
					id: id,
					data: database.encounters[id]
				};
			}
		}

		return null;
	}

	// Fallback: Find encounter ID by intro text
	function findEncounterByIntro(output) {
		const paragraphs = output.querySelectorAll('p');

		for (const entry of encounterIdLookup) {
			const encounter = database.encounters[entry.id];

			if (!encounter.intro) {
				continue;
			}

			const target = normalizeText(encounter.intro);

			for (const paragraph of paragraphs) {
				if (normalizeText(paragraph.textContent).includes(target)) {
					return {
						id: entry.id,
						data: encounter
					};
				}
			}
		}

		return null;
	}

	// Find current encounter
	function findCurrentEncounter(output) {
		// Fast check using data-action button
		const byButton = findEncounterByButton(output);

		if (byButton) {
			return byButton;
		}

		// Fallback: Check using intro text
		return findEncounterByIntro(output);
	}

	// Parse single results
	function parseSingleReward(value) {
		const parts = value.split('|');

		const result = parts[0].trim();

		const images =
    	parts[1]
        ? parts[1]
					.split(';')
					.map(x => x.trim())
					.filter(Boolean)
        : [];

		const afterText = parts.slice(2).join('|').trim();

		return {
			result: result,
			images: images,
			afterText: afterText
		};
	}

	// Parse compound results
	function parseCompoundResult(value) {
		return value
			.split('//')
			.map(part => part.trim())
			.filter(Boolean)
			.map(part =>
				parseSingleReward(part)
			);
	}

	// Parse possible results
	function parseResult(value) {
		if (Array.isArray(value)) {
			return value.map(outcome => parseCompoundResult(outcome));
		}

		return [parseCompoundResult(value)];
	}

	// Reward images
	function createRewardImage(imageName) {
    const imageUrl = database.images[imageName];

    if (!imageUrl) {
        console.warn('[Wolvhelper] Unknown image:', imageName);
        return null;
    }

    const img = document.createElement('img');

    img.src = imageUrl;
    img.loading = 'lazy';

    img.style.display = 'inline-block';
    img.style.verticalAlign = 'middle';
    img.style.width = IMAGE_WIDTH;
    img.style.height = IMAGE_HEIGHT;

    return img;
	}

	// Parse all results for an option
	function createResultElement(rewards) {
		const container = document.createElement('span');

		rewards.forEach((reward, index) => {
				if (index > 0) {
					container.appendChild(document.createTextNode(' & '));
				}

				// Reward text
				if (normalizeText(reward.result) === 'no reward') {
					const noReward = document.createElement('i');
					noReward.textContent = reward.result;
					container.appendChild(noReward);
				} else {
					container.appendChild(document.createTextNode(reward.result));
				}

				// Reward image
				for (const [imageIndex, imageName] of reward.images.entries()) {
					const img = createRewardImage(imageName);

					if (img) {
						// Space between reward text and first image only
						if (imageIndex === 0) {
							container.appendChild(document.createTextNode(' '));
						}
						container.appendChild(img);
					}
				}

				// Text after images
				if (reward.afterText) {
					container.appendChild(
						document.createTextNode(' ' + reward.afterText)
					);
				}

			}
		);

		return container;
	}

	// Create result line
	function createResultLine(buttonText, outcomes) {
		const line = document.createElement('div');
		line.style.lineHeight = LINE_HEIGHT;
		line.style.textAlign = 'left';

		// Button name
		const label = document.createElement('b');

		label.textContent = buttonText + ': ';
		label.style.whiteSpace = 'nowrap';

		line.appendChild(label);

		// Result outcomes
		outcomes.forEach((outcome, index) => {

				// Combine separator with result
				const resultWrapper = document.createElement('span');
				resultWrapper.style.display = 'inline-block';
				resultWrapper.style.whiteSpace = 'nowrap';

				// Add OR before result outcome
				if (index > 0) {
					const separator = document.createElement('span');
					separator.textContent = ' OR ';
					separator.style.fontWeight = 'bold';
					separator.style.marginLeft = '4px';

					resultWrapper.appendChild(separator);
				}

				resultWrapper.appendChild(createResultElement(outcome));

				line.appendChild(resultWrapper);
			}
		);

		return line;
	}

	// Create notes section
	function createNotesElement(notes, conditional, buttons) {
		if (!notes && !conditional) {
			return null;
		}

		const noteList = Array.isArray(notes) ? notes : notes ? [notes] : [];

		// Add conditional notes only when their button is present
		if (conditional && buttons) {
			for (const [buttonName, note] of Object.entries(conditional)) {
				const buttonExists = [...buttons].some(button =>
					normalizeText(button.textContent) === normalizeText(buttonName) ||
					normalizeText(button.textContent).startsWith(normalizeText(buttonName) + ' ')
				);

				if (buttonExists) {
					noteList.push(note);
				}
			}
		}

		if (noteList.length === 0) {
			return null;
		}

		const container = document.createElement('div');
		container.style.marginTop = '8px';
		container.style.textAlign = 'left';

		const label = document.createElement('b');
		label.textContent = 'Notes:';
		container.appendChild(label);

		for (const note of noteList) {
			const line = document.createElement('div');

			let noteText = note;

			noteText = noteText.replace(
				/(\**)\@([a-zA-Z0-9_]+)/g,
				(match, prefix, key) => {
					return database.notes?.[key]
						? prefix + database.notes[key]
						: match;
				}
			);

			const parts = noteText.split(/,\s*/);

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i].trim();

				if (!part) {
					continue;
				}

				const separator = part.indexOf('|');

				const partWrapper = document.createElement('span');
				partWrapper.style.display = 'inline-block';
				partWrapper.style.whiteSpace = 'nowrap';

				if (separator === -1) {
					partWrapper.appendChild(
						document.createTextNode(part)
					);
				} else {
					const separators = part.split('|');

					const text = separators[0].trim();
					const imageNames = separators[1]
						? separators[1]
							.split(';')
							.map(x => x.trim())
							.filter(Boolean)
						: [];

					const afterText = separators.slice(2).join('|').trim();

					if (text) {
						partWrapper.appendChild(
							document.createTextNode(text)
						);
					}

					for (const [imageIndex, imageName] of imageNames.entries()) {
						const img = createRewardImage(imageName);

						if (img) {
							if (imageIndex === 0) {
								img.style.marginLeft = '4px';
							} else {
								img.style.marginLeft = '2px';
							}

							img.style.height = '16px';
							img.style.width = '16px';

							partWrapper.appendChild(img);
						}
					}

					if (afterText) {
						partWrapper.appendChild(
							document.createTextNode(afterText)
						);
					}
				}

				line.appendChild(partWrapper);

				if (i < parts.length - 1) {
					line.appendChild(
						document.createTextNode(', ')
					);
				}
			}

			container.appendChild(line);
		}

		return container;
	}

	// Remove old output
	function clearExploreHelper() {
		const helpers = document.querySelectorAll('.' + HELPER_CLASS);

		helpers.forEach(helper => helper.remove());
	}

	// Update explore output
	function updateExploreOutput() {
		const output = document.querySelector('#explore-output');

		if (!output || !database) {
			return;
		}

		// Find current encounter
		const encounter = findCurrentEncounter(output);

		// Not in database
		if (!encounter) {
			clearExploreHelper();
			return;
		}

		// Find buttons
		const buttons = output.querySelectorAll('button');

		const resultLines = [];

		// Check each button
		for (const button of buttons) {
			const buttonText =
				button.textContent.trim();

			const normalizedButton = normalizeText(buttonText);

			let reward = null;
			let matchedName = null;

			// Match button with database options
			for (const [optionName, optionValue] of Object.entries(encounter.data.options || {})) {
				const normalizedOption = normalizeText(optionName);

				// Exact match or match to close match
				if (normalizedButton === normalizedOption || normalizedButton.startsWith(normalizedOption + ' ')) {
					reward = parseResult(optionValue);
					matchedName = optionName;
					break;
				}
			}

			// Not in database
			if (!reward) {
				continue;
			}

			// Add result
			resultLines.push(
				createResultLine(
					matchedName,
					reward
				)
			);
		}

		// Nothing to display
		if (resultLines.length === 0) {
			clearExploreHelper();
			return;
		}

		// Create or reuse helper
		let helper = output.querySelector('.' + HELPER_CLASS);

		if (!helper) {
			helper = document.createElement('div');
			helper.className = HELPER_CLASS;
			helper.style.marginTop = HELPER_MARGINS;
			helper.style.marginBottom = HELPER_MARGINS;
		}

		// Remove previous contents
		helper.replaceChildren();

		// Add current results
		for (
			const line of resultLines
		) {
			helper.appendChild(line);
		}

		// Add optional encounter notes
		const notes = createNotesElement(
			encounter.data.notes,
			encounter.data.conditional,
			buttons
		);

		if (notes) {
			helper.appendChild(notes);
		}

		// Find energy message
		const energyMessage = [...output.querySelectorAll('p')].find(p => normalizeText(p.textContent).includes('you lost'));

		// Add before energy message
		if (energyMessage) {
			energyMessage.before(helper);
		} else {
			output.appendChild(helper);
		}
	}

	// Wait for explore content to change
	function waitForExploreChange() {
		const output = document.querySelector('#explore-output');

		// Wait for #explore-output
		if (!output) {
			setTimeout(waitForExploreChange, 50);
			return;
		}

		// Save the current contents
		const oldHTML = output.innerHTML;

		const observer = new MutationObserver(() => {
				if (output.innerHTML !== oldHTML) {
					observer.disconnect();

					requestAnimationFrame(() => {
						updateExploreOutput();
					});
				}
			});

		observer.observe(output, {
				childList: true,
				subtree: true,
				characterData: true
			}
		);

		// Timeout
		setTimeout(() => {
			observer.disconnect();
		}, WAIT_TIMEOUT);
	}

	// Watch for explore steps
	document.addEventListener(
		'click',
		function (event) {
			const exploreLink = event.target.closest('#explore-explore-link');

			if (!exploreLink) {
				return;
			}

			// Remove previous encounter immediately
			clearExploreHelper();

			// Wait for new encounter
			waitForExploreChange();
		}
	);

// Start the helper
loadDatabase();

})();
