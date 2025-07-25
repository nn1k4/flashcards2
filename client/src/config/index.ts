export interface AppConfig {
  processing: {
    sentencesPerChunk: number; // количество предложений в чанке
    requestDelay: number; // задержка между запросами в мс
    enablePhraseExtraction: boolean; // автоматически выявлять фразы
  };
  claude: {
    // Профиль для основной обработки текста
    textProcessing: {
      model: string;
      maxTokens: number;
      temperature: number;
    };
    // Профиль для тестирования сервера
    healthCheck: {
      model: string;
      maxTokens: number;
      temperature: number;
    };
  };
  ui: {
    itemsPerPage: number; // элементов на странице
    autoSave: boolean; // автосохранение
  };
}

// Дефолтные настройки (базируются на текущих значениях из кода)
export const defaultConfig: AppConfig = {
  processing: {
    sentencesPerChunk: 2, // из useProcessing.ts: createSentenceChunks(sentences, 2)
    requestDelay: 800, // из useProcessing.ts: setTimeout(res, 800)
    enablePhraseExtraction: true, // выявлять фразы
  },
  claude: {
    textProcessing: {
      model: "claude-3-haiku-20240307", // из claude.ts
      maxTokens: 4096, // из claude.ts
      temperature: 0.7, // из claude.ts
    },
    healthCheck: {
      model: "claude-3-haiku-20240307", // из proxy.ts
      maxTokens: 100, // из proxy.ts
      temperature: 0.3, // стабильная температура для тестов
    },
  },
  ui: {
    itemsPerPage: 25, // для пагинации в EditView
    autoSave: true, // автосохранение настроек
  },
};

// Простой класс для работы с конфигурацией
export class ConfigManager {
  private config: AppConfig;
  private readonly storageKey = "latvian-learning-config";

  constructor() {
    this.config = this.loadConfig();
  }

  // Загрузка конфигурации из localStorage или дефолтных значений
  private loadConfig(): AppConfig {
    try {
      const saved = localStorage.getItem(this.storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Простое слияние с дефолтными значениями
        return {
          processing: { ...defaultConfig.processing, ...parsed.processing },
          claude: {
            textProcessing: {
              ...defaultConfig.claude.textProcessing,
              ...parsed.claude?.textProcessing,
            },
            healthCheck: { ...defaultConfig.claude.healthCheck, ...parsed.claude?.healthCheck },
          },
          ui: { ...defaultConfig.ui, ...parsed.ui },
        };
      }
    } catch (error) {
      console.warn("Ошибка загрузки конфигурации:", error);
    }
    return { ...defaultConfig };
  }

  // Сохранение конфигурации в localStorage
  private saveConfig(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.config));
    } catch (error) {
      console.warn("Ошибка сохранения конфигурации:", error);
    }
  }

  // Получение текущей конфигурации
  getConfig(): AppConfig {
    return { ...this.config };
  }

  // Обновление конфигурации
  updateConfig(newConfig: Partial<AppConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();
  }

  // Сброс к дефолтным значениям
  resetToDefaults(): void {
    this.config = { ...defaultConfig };
    this.saveConfig();
  }

  // Получение конкретных секций конфигурации
  getProcessingConfig() {
    return this.config.processing;
  }

  getTextProcessingConfig() {
    return this.config.claude.textProcessing;
  }

  getHealthCheckConfig() {
    return this.config.claude.healthCheck;
  }

  getUIConfig() {
    return this.config.ui;
  }
}

// Singleton экземпляр для использования в приложении
export const configManager = new ConfigManager();

// Удобные хелперы для получения конфигурации
export function getClaudeConfig(requestType: "textProcessing" | "healthCheck" = "textProcessing") {
  return configManager.getConfig().claude[requestType];
}

export function getProcessingConfig() {
  return configManager.getProcessingConfig();
}

export function getUIConfig() {
  return configManager.getUIConfig();
}
