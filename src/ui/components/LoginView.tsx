import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { theme, icons } from '../theme.js';

interface LoginViewProps {
  onBrowserLogin: () => Promise<void>;
  onPasswordLogin?: (phone: string, password: string) => Promise<void>;
  error?: string;
}

const TextInput: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  mask?: string;
  isActive?: boolean;
}> = ({ value, onChange, onSubmit, placeholder = '', mask, isActive = true }) => {
  const displayValue = mask ? mask.repeat(value.length) : value;
  const showCursor = isActive;

  useInput(
    (input, key) => {
      if (!isActive) return;

      if (key.return) {
        onSubmit();
      } else if (key.backspace || key.delete) {
        onChange(value.slice(0, -1));
      } else if (input && !key.ctrl && !key.meta) {
        onChange(value + input);
      }
    },
    { isActive }
  );

  return (
    <Box>
      <Text color={theme.text}>
        {displayValue || placeholder}
        {showCursor && <Text backgroundColor={theme.primary}> </Text>}
      </Text>
    </Box>
  );
};

export const LoginView: React.FC<LoginViewProps> = ({ onBrowserLogin, onPasswordLogin, error }) => {
  const { exit } = useApp();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'main' | 'phone' | 'password' | 'loading'>('main');
  const [localError, setLocalError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useInput(
    (input, key) => {
      if (input === 'q') {
        exit();
      }
      
      if (step === 'main' && !isSubmitting) {
        if (key.return) {
          setIsSubmitting(true);
          setStep('loading');
          onBrowserLogin().finally(() => {
            setIsSubmitting(false);
            setStep('main');
          });
        } else if (input === 'p' && onPasswordLogin) {
          setStep('phone');
        }
      }
    },
    { isActive: step === 'main' }
  );

  const handlePhoneSubmit = () => {
    if (!phone.trim()) {
      setLocalError('请输入手机号');
      return;
    }
    setLocalError('');
    setStep('password');
  };

  const handlePasswordSubmit = async () => {
    if (!password.trim()) {
      setLocalError('请输入密码');
      return;
    }
    setLocalError('');
    setIsSubmitting(true);
    setStep('loading');
    if (onPasswordLogin) {
      try {
        await onPasswordLogin(phone, password);
      } finally {
        setIsSubmitting(false);
        setStep('main');
      }
    }
  };

  return (
    <Box flexDirection="column" padding={2}>
      <Box marginBottom={1}>
        <Text color={theme.text} bold>
          登录学习通
        </Text>
      </Box>

      {step === 'main' && (
        <Box flexDirection="column">
          <Box marginBottom={2}>
            <Text color={theme.textMuted}>
              将在浏览器中打开学习通官方登录页。
            </Text>
          </Box>
          <Box marginBottom={2}>
            <Text color={theme.textMuted}>
              你可以使用扫码、短信验证码或账号密码完成登录。
            </Text>
          </Box>
          <Box>
            <Text color={theme.info}>
              {icons.arrow} [Enter] 浏览器登录（推荐）
            </Text>
          </Box>
          {onPasswordLogin && (
            <Box>
              <Text color={theme.textMuted}>
                {icons.arrow} [p] 使用账号密码登录
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text color={theme.textMuted} dimColor>
              [q] 退出
            </Text>
          </Box>
        </Box>
      )}

      {step === 'phone' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.textMuted}>手机号: </Text>
            <TextInput
              value={phone}
              onChange={setPhone}
              onSubmit={handlePhoneSubmit}
              placeholder="请输入手机号"
              isActive={true}
            />
          </Box>
          {localError && (
            <Text color={theme.error}>{localError}</Text>
          )}
          <Box marginTop={1}>
            <Text color={theme.textMuted} dimColor>按 Enter 确认 | q 退出</Text>
          </Box>
        </Box>
      )}

      {step === 'password' && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color={theme.textMuted}>手机号: </Text>
            <Text color={theme.text}>{phone}</Text>
          </Box>
          <Box marginBottom={1}>
            <Text color={theme.textMuted}>密码: </Text>
            <TextInput
              value={password}
              onChange={setPassword}
              onSubmit={handlePasswordSubmit}
              placeholder="请输入密码"
              mask="*"
              isActive={true}
            />
          </Box>
          {localError && (
            <Text color={theme.error}>{localError}</Text>
          )}
          <Box marginTop={1}>
            <Text color={theme.textMuted} dimColor>按 Enter 确认 | q 退出</Text>
          </Box>
        </Box>
      )}

      {step === 'loading' && (
        <Box flexDirection="column">
          <Text color={theme.info}>
            {icons.loading} 正在打开浏览器...
          </Text>
          <Box marginTop={1}>
            <Text color={theme.textMuted} dimColor>请在浏览器中完成登录</Text>
          </Box>
        </Box>
      )}

      {error && (
        <Box marginTop={1}>
          <Text color={theme.error}>
            {icons.error} {error}
          </Text>
        </Box>
      )}
    </Box>
  );
};