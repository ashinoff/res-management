// =====================================================
// ПОЛНЫЙ BACKEND ДЛЯ СИСТЕМЫ УПРАВЛЕНИЯ РЭС
// Версия с ВСЕМИ исправлениями и улучшениями
// =====================================================

// Устанавливаем кодировку
process.env.LANG = 'ru_RU.UTF-8';
process.env.LC_ALL = 'ru_RU.UTF-8';
process.env.NODE_OPTIONS = '--encoding=utf-8';

console.log('Server starting...');

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

const express = require('express');
console.log('Express loaded');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { Sequelize, DataTypes, Op } = require('sequelize');

// =====================================================
// КОНФИГУРАЦИЯ И ИНИЦИАЛИЗАЦИЯ
// =====================================================

require('dotenv').config();
const app = express();
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});
const PORT = process.env.PORT || 3000;

// ВАЖНО: Пароль для удаления из переменной окружения
const DELETE_PASSWORD = process.env.DELETE_PASSWORD || '1191';

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Health check для Render
app.get('/', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'RES Management Backend is running',
    version: '1.0.0'
  });
});

// Создаем папку uploads если её нет
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// =====================================================
// ПОДКЛЮЧЕНИЕ К БД (PostgreSQL на Render)
// =====================================================

const sequelize = new Sequelize(process.env.DATABASE_URL || 'postgres://user:pass@localhost:5432/dbname', {
  dialect: 'postgres',
  protocol: 'postgres',
  dialectOptions: {
    ssl: process.env.NODE_ENV === 'production' ? {
      require: true,
      rejectUnauthorized: false
    } : false,
    charset: 'utf8',
    client_encoding: 'UTF8'
  },
  logging: false
});

// =====================================================
// МОДЕЛИ ДАННЫХ
// =====================================================

// 1. Модель РЭС (районов)
const ResUnit = sequelize.define('ResUnit', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  }
});

// 2. Модель пользователей
const User = sequelize.define('User', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fio: {
    type: DataTypes.STRING,
    allowNull: false
  },
  login: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  role: {
    type: DataTypes.ENUM('admin', 'uploader', 'res_responsible'),
    allowNull: false
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

// 3. Модель структуры сети (ТП и ВЛ)
const NetworkStructure = sequelize.define('NetworkStructure', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  resId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  tpName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vlName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  startPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  endPu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  middlePu: {
    type: DataTypes.STRING,
    allowNull: true
  },
  lastUpdate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
});

// 4. Модель статусов ПУ (приборов учета)
const PuStatus = sequelize.define('PuStatus', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  position: {
    type: DataTypes.ENUM('start', 'end', 'middle'),
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('not_checked', 'checked_ok', 'checked_error', 'pending_recheck', 'empty'),
    defaultValue: 'not_checked'
  },
  errorDetails: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  lastCheck: {
    type: DataTypes.DATE,
    allowNull: true
  }
});

// 5. Модель уведомлений
const Notification = sequelize.define('Notification', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fromUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  toUserId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  puStatusId: {
    type: DataTypes.INTEGER,
    references: {
      model: PuStatus,
      key: 'id'
    }
  },
  type: {
    type: DataTypes.ENUM('error', 'success', 'info', 'pending_check', 'pending_askue'),
    allowNull: false
  },
  message: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  errorData: {
    type: DataTypes.JSON,
    allowNull: true
  },
  comment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  checkFromDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  isRead: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

// 6. Модель истории загрузок
const UploadHistory = sequelize.define('UploadHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: 'id'
    }
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  fileName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  fileType: {
    type: DataTypes.ENUM('rim_single', 'rim_mass', 'nartis', 'energomera'),
    allowNull: false
  },
  processedCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  errorCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  status: {
    type: DataTypes.ENUM('processing', 'completed', 'failed'),
    defaultValue: 'processing'
  }
});

// 7. Модель истории проверок
const CheckHistory = sequelize.define('CheckHistory', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  resId: {
    type: DataTypes.INTEGER,
    references: {
      model: ResUnit,
      key: 'id'
    }
  },
  networkStructureId: {
    type: DataTypes.INTEGER,
    references: {
      model: NetworkStructure,
      key: 'id'
    }
  },
  puNumber: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tpName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  vlName: {
    type: DataTypes.STRING,
    allowNull: false
  },
  position: {
    type: DataTypes.ENUM('start', 'end', 'middle'),
    allowNull: false
  },
  initialError: {
    type: DataTypes.TEXT,
    allowNull: false
  },
  initialCheckDate: {
    type: DataTypes.DATE,
    allowNull: false
  },
  resComment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  workCompletedDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  recheckDate: {
    type: DataTypes.DATE,
    allowNull: true
  },
  recheckResult: {
    type: DataTypes.ENUM('pending', 'ok', 'error'),
    defaultValue: 'pending'
  },
  status: {
    type: DataTypes.ENUM('awaiting_work', 'awaiting_recheck', 'completed'),
    defaultValue: 'awaiting_work'
  }
});

// =====================================================
// СВЯЗИ МЕЖДУ МОДЕЛЯМИ
// =====================================================

User.belongsTo(ResUnit, { foreignKey: 'resId' });
NetworkStructure.belongsTo(ResUnit, { foreignKey: 'resId' });
NetworkStructure.hasMany(PuStatus, { foreignKey: 'networkStructureId' });
PuStatus.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.belongsTo(User, { as: 'fromUser', foreignKey: 'fromUserId' });
Notification.belongsTo(User, { as: 'toUser', foreignKey: 'toUserId' });
Notification.belongsTo(ResUnit, { foreignKey: 'resId' });
Notification.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });
Notification.belongsTo(PuStatus, { foreignKey: 'puStatusId' });
UploadHistory.belongsTo(User, { foreignKey: 'userId' });
UploadHistory.belongsTo(ResUnit, { foreignKey: 'resId' });
CheckHistory.belongsTo(ResUnit, { foreignKey: 'resId' });
CheckHistory.belongsTo(NetworkStructure, { foreignKey: 'networkStructureId' });

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// =====================================================

// Хеширование паролей
User.beforeCreate(async (user) => {
  user.password = await bcrypt.hash(user.password, 10);
});

// Валидация пароля
User.prototype.validatePassword = async function(password) {
  return bcrypt.compare(password, this.password);
};

// Middleware для проверки JWT токена
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
};

// Middleware для проверки ролей
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied for your role' });
    }
    next();
  };
};

// Настройка multer для загрузки файлов с ограничением размера
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB максимум
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Разрешены только Excel и CSV файлы'));
    }
  }
});

// Обработчик ошибок multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ 
        error: 'Файл слишком большой. Максимальный размер: 10MB' 
      });
    }
  }
  next(error);
});

// Email сервис
const createEmailTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.MAIL_HOST || 'smtp.mail.ru',
    port: process.env.MAIL_PORT || 465,
    secure: true,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });
};

// =====================================================
// API РОУТЫ
// =====================================================

// 1. АВТОРИЗАЦИЯ
app.post('/api/auth/login', async (req, res) => {
  try {
    const { login, password } = req.body;
    
    const user = await User.findOne({ 
      where: { login },
      include: [ResUnit]
    });
    
    if (!user || !(await user.validatePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { 
        id: user.id, 
        role: user.role, 
        resId: user.resId,
        
      },
      process.env.JWT_SECRET || 'secret-key',
      { expiresIn: '24h' }
    );
    
    res.json({
      token,
      user: {
        id: user.id,
        fio: user.fio,
        role: user.role,
        resId: user.resId,
        resName: user.ResUnit?.name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 2. ПОЛУЧЕНИЕ СПИСКА РЭС
app.get('/api/res/list', authenticateToken, async (req, res) => {
  try {
    const resList = await ResUnit.findAll();
    res.json(resList);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ПОЛУЧЕНИЕ СТРУКТУРЫ СЕТИ
app.get('/api/network/structure/:resId?', authenticateToken, async (req, res) => {
  try {
    const resId = req.params.resId || req.user.resId;
    
    // Если не админ, может видеть только свой РЭС
    if (req.user.role !== 'admin' && resId != req.user.resId) {
      return res.status(403).json({ error: 'Access denied' });
    }
    
    // Адлерский РЭС (id=2) также видит СИРИУС (id=8)
    let whereClause = {};
    if (resId) {
      if (resId == 2 || req.user.resId == 2) {
        // Если смотрим Адлерский РЭС или пользователь из Адлерского - показываем и СИРИУС
        whereClause = { resId: { [Op.in]: [2, 8] } };
      } else {
        whereClause = { resId };
      }
    }
    
    const structures = await NetworkStructure.findAll({
      where: whereClause,
      include: [
        {
          model: PuStatus,
          required: false,
          attributes: ['id', 'puNumber', 'position', 'status', 'errorDetails', 'lastCheck']
        },
        ResUnit
      ],
      order: [['tpName', 'ASC'], ['vlName', 'ASC']]
    });
    
    res.json(structures);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. ОБНОВЛЕНИЕ структуры сети (только админ)
app.put('/api/network/structure/:id', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { startPu, middlePu, endPu } = req.body;
      
      await NetworkStructure.update({
        startPu: startPu || null,
        middlePu: middlePu || null,
        endPu: endPu || null,
        lastUpdate: new Date()
      }, {
        where: { id: req.params.id }
      });
      
      res.json({ success: true, message: 'Структура обновлена' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});

// 5. ЗАГРУЗКА ФАЙЛОВ ДЛЯ АНАЛИЗА
app.post('/api/upload/analyze',
  authenticateToken,
  checkRole(['admin', 'uploader']),
  upload.single('file'),
  async (req, res) => {
    let uploadRecord;
    try {
      const { type } = req.body;
      const userId = req.user.id;
      
      // Берем resId из body (если есть) или из токена пользователя
      const resId = req.body.resId || req.user.resId;

      console.log('=== UPLOAD ANALYZE START ===');
      console.log('User:', req.user);
      console.log('Request body:', req.body);
      console.log('Final resId:', resId);
      console.log('File:', req.file?.originalname);

      if (!resId) {
        return res.status(400).json({ error: 'Не выбран РЭС для загрузки' });
      }
      
      // Создаем запись в истории
      uploadRecord = await UploadHistory.create({
        userId,
        resId,
        fileName: req.file.originalname,
        fileType: type,
        status: 'processing'
      });
      
      console.log('Upload record created:', uploadRecord.id);
      
      // Запускаем анализ с передачей оригинального имени файла
      console.log('Starting analysis...');
      const analysisResult = await analyzeFile(
        req.file.path, 
        type, 
        req.file.originalname  // передаем оригинальное имя
      );
      
      console.log('Analysis result:', {
        processed: analysisResult.processed.length,
        errors: analysisResult.errors.length
      });
      
      // Обновляем историю
      await uploadRecord.update({
        processedCount: analysisResult.processed.length,
        errorCount: analysisResult.errors.length,
        status: 'completed'
      });
      
      // Отправляем уведомления если есть ошибки
      if (analysisResult.errors.length > 0) {
        console.log(`Creating notifications for ${analysisResult.errors.length} errors`);
        try {
          await createNotifications(userId, resId, analysisResult.errors);
          console.log('Notifications created successfully');
        } catch (notifError) {
          console.error('Error creating notifications:', notifError);
          // НЕ падаем, продолжаем работу!
        }
      }
      
      console.log('=== UPLOAD ANALYZE COMPLETE ===');
      
      // Возвращаем результат
      res.json({
        success: true,
        message: 'Файл обработан успешно',
        processed: analysisResult.processed.length,
        errors: analysisResult.errors.length,
        details: analysisResult.processed
      });
      
    } catch (error) {
      console.error('Upload analyze error:', error);
      
      // Обновляем статус в истории
      if (uploadRecord) {
        await uploadRecord.update({ status: 'failed' });
      }
      
      res.status(500).json({ 
        success: false,
        error: error.message 
      });
    }
});

// 6. ЗАГРУЗКА ПОЛНОЙ СТРУКТУРЫ СЕТИ
app.post('/api/network/upload-full-structure', 
  authenticateToken, 
  checkRole(['admin']), 
  upload.single('file'), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
      
      let processed = 0;
      let errors = [];
      
      // Опционально: очищаем старые данные
      if (req.body.clearOld === 'true') {
        await NetworkStructure.destroy({ where: {}, transaction });
      }
      
      // Обрабатываем каждую строку
      for (const row of data) {
        try {
          // Ищем РЭС по полному имени из Excel
          const resName = row['РЭС'];
          const res = await ResUnit.findOne({ 
            where: { name: resName },
            transaction 
          });
          
          if (!res) {
            errors.push(`Неизвестный РЭС: ${resName}`);
            continue;
          }
          
          // Создаем или обновляем запись
          await NetworkStructure.upsert({
            resId: res.id,
            tpName: row['ТП'] || '',
            vlName: row['Фидер'] || '',
            startPu: row['Начало'] ? String(row['Начало']) : null,
            endPu: row['Конец'] ? String(row['Конец']) : null,
            middlePu: row['Середина'] ? String(row['Середина']) : null
          }, {
            transaction
          });
          
          processed++;
          
          // Создаем статусы для новых ПУ
          const positions = [
            { pu: row['Начало'], pos: 'start' },
            { pu: row['Конец'], pos: 'end' },
            { pu: row['Середина'], pos: 'middle' }
          ];
          
          for (const { pu, pos } of positions) {
            if (pu) {
              await PuStatus.findOrCreate({
                where: { puNumber: String(pu) },
                defaults: {
                  position: pos,
                  status: 'not_checked'
                },
                transaction
              });
            }
          }
          
        } catch (err) {
          errors.push(`Ошибка в строке ${row['ТП']}-${row['Фидер']}: ${err.message}`);
        }
      }
      
      await transaction.commit();
      
      // Удаляем файл
      fs.unlinkSync(req.file.path);
      
      res.json({
        success: true,
        message: `Загружено ${processed} записей из ${data.length}`,
        processed,
        total: data.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : []
      });
      
    } catch (error) {
      await transaction.rollback();
      res.status(500).json({ error: error.message });
    }
});

// 7. ПОЛУЧЕНИЕ УВЕДОМЛЕНИЙ
app.get('/api/notifications', authenticateToken, async (req, res) => {
  try {
    const whereClause = req.user.role === 'admin' 
      ? {}  // Админ видит ВСЕ
      : { toUserId: req.user.id };  // Остальные только свои
    
    const notifications = await Notification.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'fromUser' },
        { model: User, as: 'toUser' },
        ResUnit,
        NetworkStructure
      ],
      order: [['createdAt', 'DESC']],
      limit: 50
    });
    
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 8. ВЫПОЛНЕНИЕ МЕРОПРИЯТИЙ
app.post('/api/notifications/:id/complete-work', 
  authenticateToken, 
  checkRole(['res_responsible']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { comment, checkFromDate } = req.body;
      
      // Проверка на количество слов (минимум 5)
      const wordCount = comment.trim().split(/\s+/).filter(word => word.length > 0).length;
      if (wordCount < 5) {
        return res.status(400).json({ error: 'Комментарий должен содержать не менее 5 слов' });
      }
      
      // Находим уведомление
      const notification = await Notification.findByPk(req.params.id);
      if (!notification) {
        await transaction.rollback();
        return res.status(404).json({ error: 'Уведомление не найдено' });
      }
      
      // Парсим данные об ошибке
      const errorData = JSON.parse(notification.message);
      
      // Создаем запись в истории проверок
      await CheckHistory.create({
        resId: notification.resId,
        networkStructureId: notification.networkStructureId,
        puNumber: errorData.puNumber,
        tpName: errorData.tpName,
        vlName: errorData.vlName,
        position: errorData.position,
        initialError: errorData.errorDetails,
        initialCheckDate: notification.createdAt,
        resComment: comment,
        workCompletedDate: new Date(),
        status: 'awaiting_recheck'
      }, { transaction });
      
      // Обновляем статус ПУ на pending_recheck
      await PuStatus.update(
        { status: 'pending_recheck' },
        { 
          where: { puNumber: errorData.puNumber },
          transaction
        }
      );
      
      // Помечаем старое уведомление как прочитанное
      await notification.update({ isRead: true }, { transaction });
      
      // Создаем новое уведомление для АСКУЭ
      const askueUsers = await User.findAll({
        where: {
          resId: notification.resId,
          role: 'uploader'
        }
      });
      
      const askueMessage = {
        puNumber: errorData.puNumber,
        position: errorData.position,
        tpName: errorData.tpName,
        vlName: errorData.vlName,
        resName: errorData.resName,
        errorDetails: errorData.errorDetails,
        checkFromDate: checkFromDate || new Date().toISOString().split('T')[0],
        completedComment: comment,
        completedBy: req.user.id,
        completedAt: new Date()
      };
      
      for (const askueUser of askueUsers) {
        await Notification.create({
          fromUserId: req.user.id,
          toUserId: askueUser.id,
          resId: notification.resId,
          networkStructureId: notification.networkStructureId,
          type: 'pending_askue',
          message: JSON.stringify(askueMessage),
          isRead: false
        }, { transaction });
      }
      
      await transaction.commit();
      res.json({ success: true, message: 'Мероприятия отмечены как выполненные' });
      
    } catch (error) {
      await transaction.rollback();
      console.error('Complete work error:', error);
      res.status(500).json({ error: error.message });
    }
});

// 9. ОЧИСТКА ВСЕХ ДАННЫХ
app.delete('/api/network/clear-all', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      console.log('Starting complete data cleanup...');
      
      // Порядок важен! Сначала удаляем зависимые данные
      const uploadsDeleted = await UploadHistory.destroy({ where: {}, transaction });
      console.log(`Deleted ${uploadsDeleted} upload records`);
      
      const notificationsDeleted = await Notification.destroy({ where: {}, transaction });
      console.log(`Deleted ${notificationsDeleted} notifications`);
      
      const puStatusesDeleted = await PuStatus.destroy({ where: {}, transaction });
      console.log(`Deleted ${puStatusesDeleted} PU statuses`);
      
      const structuresDeleted = await NetworkStructure.destroy({ where: {}, transaction });
      console.log(`Deleted ${structuresDeleted} network structures`);
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: 'Все данные успешно удалены',
        deleted: {
          uploads: uploadsDeleted,
          notifications: notificationsDeleted,
          puStatuses: puStatusesDeleted,
          structures: structuresDeleted
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      console.error('Clear all error:', error);
      res.status(500).json({ 
        error: 'Ошибка при удалении данных: ' + error.message 
      });
    }
});

// 10. УДАЛЕНИЕ ВЫБРАННЫХ СТРУКТУР
app.post('/api/network/delete-selected', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    const transaction = await sequelize.transaction();
    
    try {
      const { ids, password } = req.body;
      
      // Проверка пароля через переменную окружения
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Не выбраны записи для удаления' });
      }
      
      console.log(`Deleting network structures: ${ids.join(', ')}`);
      
      // Сначала удаляем связанные данные
      const notificationsDeleted = await Notification.destroy({
        where: { networkStructureId: { [Op.in]: ids } },
        transaction
      });
      
      const puStatusesDeleted = await PuStatus.destroy({
        where: { networkStructureId: { [Op.in]: ids } },
        transaction
      });
      
      const structuresDeleted = await NetworkStructure.destroy({
        where: { id: { [Op.in]: ids } },
        transaction
      });
      
      await transaction.commit();
      
      res.json({
        success: true,
        message: `Удалено ${structuresDeleted} записей`,
        deleted: {
          structures: structuresDeleted,
          notifications: notificationsDeleted,
          puStatuses: puStatusesDeleted
        }
      });
      
    } catch (error) {
      await transaction.rollback();
      console.error('Delete selected error:', error);
      res.status(500).json({ error: error.message });
    }
});

// 11. ДЕТАЛЬНЫЕ ОТЧЕТЫ
app.get('/api/reports/detailed', authenticateToken, async (req, res) => {
  try {
    const { type, dateFrom, dateTo } = req.query;
    
    let whereClause = {};
    if (dateFrom || dateTo) {
      whereClause.createdAt = {};
      if (dateFrom) whereClause.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) {
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        whereClause.createdAt[Op.lte] = endDate;
      }
    }
    
    // Добавляем фильтр по РЭС для не-админов
    if (req.user.role !== 'admin') {
      whereClause.resId = req.user.resId;
    }
    
    let reportData = [];
    
    switch (type) {
      case 'pending_work':
        // Ожидающие мероприятий
        const pendingWork = await Notification.findAll({
          where: {
            ...whereClause,
            type: 'error',
            isRead: false
          },
          include: [
            { model: ResUnit },
            { model: NetworkStructure }
          ]
        });
        
        reportData = pendingWork.map(n => {
          const data = JSON.parse(n.message);
          return {
            resName: n.ResUnit?.name,
            tpName: data.tpName,
            vlName: data.vlName,
            position: data.position,
            puNumber: data.puNumber,
            errorDetails: data.errorDetails,
            errorDate: n.createdAt
          };
        });
        break;
        
      case 'pending_askue':
        // Ожидающие проверки АСКУЭ
        const pendingAskue = await Notification.findAll({
          where: {
            ...whereClause,
            type: 'pending_askue',
            isRead: false
          },
          include: [
            { model: ResUnit },
            { model: NetworkStructure }
          ]
        });
        
        reportData = pendingAskue.map(n => {
          const data = JSON.parse(n.message);
          return {
            resName: n.ResUnit?.name,
            tpName: data.tpName,
            vlName: data.vlName,
            position: data.position,
            puNumber: data.puNumber,
            errorDetails: data.errorDetails || 'Требуется перепроверка',
            errorDate: n.createdAt,
            resComment: data.completedComment,
            workCompletedDate: data.completedAt
          };
        });
        break;
        
      case 'completed':
        // Завершенные проверки
        const completed = await CheckHistory.findAll({
          where: {
            ...whereClause,
            status: 'completed'
          },
          include: [ResUnit]
        });
        
        reportData = completed.map(h => ({
          resName: h.ResUnit?.name,
          tpName: h.tpName,
          vlName: h.vlName,
          position: h.position,
          puNumber: h.puNumber,
          errorDetails: h.initialError,
          errorDate: h.initialCheckDate,
          resComment: h.resComment,
          workCompletedDate: h.workCompletedDate,
          recheckDate: h.recheckDate,
          recheckResult: h.recheckResult
        }));
        break;
    }
    
    res.json(reportData);
  } catch (error) {
    console.error('Detailed reports error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 12. УДАЛЕНИЕ УВЕДОМЛЕНИЙ
app.delete('/api/notifications/:id', 
  authenticateToken, 
  checkRole(['admin']), 
  async (req, res) => {
    try {
      const { password } = req.body;
      
      // Проверка пароля через переменную окружения
      if (password !== DELETE_PASSWORD) {
        return res.status(403).json({ error: 'Неверный пароль' });
      }
      
      const notification = await Notification.findByPk(req.params.id);
      if (!notification) {
        return res.status(404).json({ error: 'Уведомление не найдено' });
      }
      
      await notification.destroy();
      
      res.json({ 
        success: true, 
        message: 'Уведомление удалено' 
      });
      
    } catch (error) {
      console.error('Delete notification error:', error);
      res.status(500).json({ error: error.message });
    }
});

// =====================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ АНАЛИЗА
// =====================================================

// Анализ файлов через Python скрипты
async function analyzeFile(filePath, type, originalFileName = null) {
  return new Promise((resolve, reject) => {
    let scriptPath;
    
    // Используем правильный путь для Render
    const analyzersDir = path.join(process.cwd(), 'analyzers');
    
    switch(type) {
      case 'rim_single':
        scriptPath = path.join(analyzersDir, 'rim_single.py');
        break;
      case 'rim_mass':
        scriptPath = path.join(analyzersDir, 'rim_mass_analyzer.py');
        break;
      case 'nartis':
        scriptPath = path.join(analyzersDir, 'nartis_analyzer.py');
        break;
      case 'energomera':
        scriptPath = path.join(analyzersDir, 'energomera_analyzer.py');
        break;
      default:
        return resolve({
          processed: [],
          errors: ['Неизвестный тип анализатора']
        });
    }
    
    // Проверяем существование директории analyzers
    if (!fs.existsSync(analyzersDir)) {
      console.error('Analyzers directory not found:', analyzersDir);
      return resolve({
        processed: [],
        errors: [`Директория analyzers не найдена`]
      });
    }
    
    // Проверяем существование Python скрипта
    if (!fs.existsSync(scriptPath)) {
      console.error('Python script not found:', scriptPath);
      return resolve({
        processed: [],
        errors: [`Python скрипт не найден: ${scriptPath}`]
      });
    }
    
    // Пробуем запустить Python
    let python;
    try {
      python = spawn('python3', [scriptPath, filePath]);
      console.log('Python3 spawn created successfully');
    } catch (err) {
      console.error('Failed to spawn python3, trying python:', err);
      try {
        python = spawn('python', [scriptPath, filePath]);
        console.log('Python spawn created successfully');
      } catch (err2) {
        console.error('Both python3 and python failed:', err2);
        return resolve({
          processed: [],
          errors: ['Python не установлен на сервере. Убедитесь что в Build Command есть: npm install && pip install xlrd']
        });
      }
    }

    console.log('Running Python script:', scriptPath);
    console.log('Analyzing file:', filePath);

    let output = '';
    let errorOutput = '';

    python.stdout.on('data', (data) => {
      output += data.toString();
      console.log('Python stdout chunk:', data.toString());
    });

    python.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.error('Python stderr:', data.toString());
    });

    python.on('error', (error) => {
      console.error('Python process error:', error);
      return resolve({
        processed: [],
        errors: [`Python не установлен или недоступен. Убедитесь что в Build Command на Render есть: npm install && pip install xlrd`]
      });
    });

    python.on('close', async (code) => {
      console.log('Python process closed with code:', code);
      console.log('Final output length:', output.length);
      console.log('Final output:', output);
      console.log('Final errors:', errorOutput);
      
      if (code !== 0) {
        return resolve({
          processed: [],
          errors: [`Ошибка анализа (код ${code}): ${errorOutput}`]
        });
      }
      
      try {
        // Парсим результат от Python
        const result = JSON.parse(output);
        console.log('Parsed result:', JSON.stringify(result));
        
        if (result.success) {
          const processed = [];
          const errors = [];
          
          // Извлекаем номер ПУ из имени файла
          const fileName = originalFileName 
            ? path.basename(originalFileName, path.extname(originalFileName))
            : path.basename(filePath, path.extname(filePath));
          
          console.log('Extracted PU number from filename:', fileName);
          
          // Ищем ПУ в структуре сети
          const networkStructure = await NetworkStructure.findOne({
            where: {
              [Op.or]: [
                { startPu: fileName },
                { endPu: fileName },
                { middlePu: fileName }
              ]
            },
            include: [ResUnit]
          });
          
          if (networkStructure) {
            console.log(`Found network structure for PU ${fileName}: TP=${networkStructure.tpName}, VL=${networkStructure.vlName}`);
            
            // Определяем позицию
            let position = 'start';
            if (networkStructure.endPu === fileName) position = 'end';
            else if (networkStructure.middlePu === fileName) position = 'middle';
            
            console.log(`PU position determined: ${position}`);
            
            // Создаем или обновляем статус ПУ
            const [puStatus, created] = await PuStatus.upsert({
              puNumber: fileName,
              networkStructureId: networkStructure.id,
              position: position,
              status: result.has_errors ? 'checked_error' : 'checked_ok',
              errorDetails: result.has_errors ? result.summary : null,
              lastCheck: new Date()
            });
            
            console.log(`PU ${fileName} ${created ? 'created' : 'updated'} with status: ${result.has_errors ? 'ERROR' : 'OK'}`);
            
            // Проверяем, не является ли это перепроверкой
            const existingNotification = await Notification.findOne({
              where: {
                type: 'pending_askue',
                isRead: false,
                message: {
                  [Op.like]: `%"puNumber":"${fileName}"%`
                }
              }
            });

            if (existingNotification) {
              console.log(`Found pending ASKUE notification for PU ${fileName} - this is a recheck`);
              
              // Это перепроверка!
              const notifData = JSON.parse(existingNotification.message);
              
              if (!result.has_errors) {
                // Ошибки исправлены
                console.log(`Recheck successful - errors fixed for PU ${fileName}`);
                
                // Обновляем запись в истории
                await CheckHistory.update({
                  recheckDate: new Date(),
                  recheckResult: 'ok',
                  status: 'completed'
                }, {
                  where: {
                    puNumber: fileName,
                    status: 'awaiting_recheck'
                  }
                });
                
                // Помечаем уведомление как прочитанное
                await existingNotification.update({ isRead: true });
                
                // Отправляем уведомление ответственному что проблема решена
                await Notification.create({
                  fromUserId: 1, // Системное уведомление
                  toUserId: notifData.completedBy,
                  resId: networkStructure.resId,
                  networkStructureId: networkStructure.id,
                  type: 'success',
                  message: `✅ Проблема с ПУ ${fileName} (${networkStructure.tpName} - ${networkStructure.vlName}) успешно устранена!`,
                  isRead: false
                });
                
              } else {
                // Ошибки НЕ исправлены
                console.log(`Recheck failed - errors still present for PU ${fileName}`);
                
                // Обновляем запись в истории
                await CheckHistory.update({
                  recheckDate: new Date(),
                  recheckResult: 'error',
                  status: 'completed'
                }, {
                  where: {
                    puNumber: fileName,
                    status: 'awaiting_recheck'
                  }
                });
              }
            }
            
            // Добавляем в processed
            processed.push({
              puNumber: fileName,
              status: result.has_errors ? 'checked_error' : 'checked_ok',
              error: result.has_errors ? result.summary : null
            });
            
            // Если есть ошибки - добавляем для уведомлений
            if (result.has_errors && !existingNotification) {
              errors.push({
                puNumber: fileName,
                error: result.summary,
                details: result.details,
                networkStructureId: networkStructure.id,
                resId: networkStructure.resId
              });
              console.log('Added error for notification:', fileName);
            }
          } else {
            console.log(`WARNING: NetworkStructure not found for PU: ${fileName}`);
            console.log('This PU will not be processed and no notifications will be created!');
            
            // Все равно добавляем в processed чтобы показать что файл обработан
            processed.push({
              puNumber: fileName,
              status: 'not_in_structure',
              error: 'ПУ не найден в структуре сети'
            });
          }
          
          // Удаляем файл после обработки
          try {
            fs.unlinkSync(filePath);
            console.log('Temporary file deleted');
          } catch (err) {
            console.error('Error deleting file:', err);
          }
          
          console.log(`Analysis complete: processed=${processed.length}, errors=${errors.length}`);
          resolve({ processed, errors });
          
        } else {
          console.error('Python script returned success=false:', result.error);
          resolve({
            processed: [],
            errors: [result.error || 'Неизвестная ошибка Python скрипта']
          });
        }
      } catch (e) {
        console.error('Failed to parse Python output:', e);
        console.error('Raw output was:', output);
        resolve({
          processed: [],
          errors: [`Ошибка парсинга результата: ${e.message}`]
        });
      }
    });
  });
}

// Создание уведомлений об ошибках
async function createNotifications(fromUserId, resId, errors) {
  console.log('Creating notifications for errors:', errors);
  console.log(`Looking for users with res_responsible or admin role for RES ${resId}`);
  
  // Находим всех кто должен получить уведомления
  const responsibles = await User.findAll({
    where: {
      [Op.or]: [
        { role: 'admin' },  // Админы видят все
        { 
          resId,
          role: 'res_responsible'  // Ответственные только своего РЭС
        }
      ]
    }
  });
  
  console.log(`Found ${responsibles.length} users to notify`);
  if (responsibles.length === 0) {
    console.log('WARNING: No users found to notify!');
    return;
  }
  
  for (const errorInfo of errors) {
    console.log(`Processing error for PU: ${errorInfo.puNumber}`);
    
    // Находим структуру сети для этого ПУ
    const networkStructure = await NetworkStructure.findOne({
      where: {
        [Op.or]: [
          { startPu: errorInfo.puNumber },
          { middlePu: errorInfo.puNumber },
          { endPu: errorInfo.puNumber }
        ]
      },
      include: [ResUnit]
    });
    
    if (!networkStructure) {
      console.log(`WARNING: No network structure found for PU ${errorInfo.puNumber}`);
      continue;
    }
    
    console.log(`NetworkStructure found: TP=${networkStructure.tpName}, VL=${networkStructure.vlName}`);
    
    // Определяем позицию ПУ
    let position = 'start';
    if (networkStructure.middlePu === errorInfo.puNumber) position = 'middle';
    else if (networkStructure.endPu === errorInfo.puNumber) position = 'end';
    
    // Формируем данные для уведомления
    const errorData = {
      puNumber: errorInfo.puNumber,
      position: position,
      tpName: networkStructure.tpName,
      vlName: networkStructure.vlName,
      resName: networkStructure.ResUnit.name,
      errorDetails: errorInfo.error,
      details: errorInfo.details
    };
    
    console.log('Creating notifications with data:', errorData);
    
    // Создаем уведомления для каждого ответственного
    for (const responsible of responsibles) {
      try {
        const notification = await Notification.create({
          fromUserId,
          toUserId: responsible.id,
          resId,
          networkStructureId: networkStructure.id,
          type: 'error',
          message: JSON.stringify(errorData),
          isRead: false
        });
        console.log(`Notification created for user ${responsible.fio} (id: ${responsible.id})`);
      } catch (err) {
        console.error(`Failed to create notification for user ${responsible.id}:`, err);
      }
    }
  }
  
  console.log('All notifications created');
}

// =====================================================
// ИНИЦИАЛИЗАЦИЯ БД И ЗАПУСК СЕРВЕРА
// =====================================================

async function initializeDatabase() {
  try {
    await sequelize.authenticate();
    console.log('Database connected successfully');
    
    // Синхронизация моделей
    await sequelize.sync({ alter: true });
    console.log('Ensuring CheckHistory table...');
    await CheckHistory.sync({ alter: true });
    
    // Создаем РЭСы если их нет
    const resCount = await ResUnit.count();
    if (resCount === 0) {
      const resList = [
        'Краснополянский РЭС',
        'Адлерский РЭС',
        'Хостинский РЭС',
        'Сочинский РЭС',
        'Дагомысский РЭС',
        'Лазаревский РЭС',
        'Туапсинский РЭС'
      ];
      
      for (const resName of resList) {
        await ResUnit.create({ name: resName });
      }
      console.log('RES units created');
    }
    
    // Создаем СИРИУС
    try {
      const [sirius, created] = await ResUnit.findOrCreate({
        where: { name: 'СИРИУС' },
        defaults: { name: 'СИРИУС' }
      });
      console.log('SIRIUS added/checked', created ? 'created' : 'exists');
    } catch (err) {
      console.error('Error creating SIRIUS:', err);
    }
    
    // Удаляем опечатку СИРИСУС если есть
    try {
      const deleted = await ResUnit.destroy({ 
        where: { name: 'СИРИСУС' } 
      });
      if (deleted > 0) {
        console.log('Removed SIRISUS typo');
      }
    } catch (err) {
      console.error('Error removing SIRISUS:', err);
    }
    
    console.log('Database initialization complete');
    
    // Создаем админа если его нет
    const adminCount = await User.count({ where: { role: 'admin' } });
    if (adminCount === 0) {
      await User.create({
        fio: 'Администратор',
        login: 'admin',
        password: 'admin123',
        role: 'admin',
        email: 'admin@res.ru'
      });
      console.log('Admin user created');
    }
    
  } catch (error) {
    console.error('Database initialization error:', error);
    process.exit(1);
  }
}

// Запуск сервера
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});

// Обработка ошибок
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  process.exit(1);
});
