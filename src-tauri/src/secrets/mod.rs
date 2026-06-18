use keyring::Entry;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("secure storage unavailable")]
    Backend,
}

pub trait SecretStore: Send + Sync {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError>;
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError>;
    fn delete(&self, account: &str) -> Result<(), SecretError>;
}

pub struct KeyringSecretStore {
    service: String,
}

impl KeyringSecretStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }
}

impl SecretStore for KeyringSecretStore {
    fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
        let entry = Entry::new(&self.service, account).map_err(|_| SecretError::Backend)?;
        match entry.get_password() {
            Ok(p) => Ok(Some(p)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(SecretError::Backend),
        }
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
        let entry = Entry::new(&self.service, account).map_err(|_| SecretError::Backend)?;
        entry.set_password(secret).map_err(|_| SecretError::Backend)
    }
    fn delete(&self, account: &str) -> Result<(), SecretError> {
        let entry = Entry::new(&self.service, account).map_err(|_| SecretError::Backend)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(SecretError::Backend),
        }
    }
}

#[cfg(test)]
pub mod fake {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    #[derive(Default)]
    pub struct FakeSecretStore {
        map: Mutex<HashMap<String, String>>,
    }

    impl SecretStore for FakeSecretStore {
        fn get(&self, account: &str) -> Result<Option<String>, SecretError> {
            Ok(self.map.lock().unwrap().get(account).cloned())
        }
        fn set(&self, account: &str, secret: &str) -> Result<(), SecretError> {
            self.map
                .lock()
                .unwrap()
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }
        fn delete(&self, account: &str) -> Result<(), SecretError> {
            self.map.lock().unwrap().remove(account);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::FakeSecretStore;
    use super::SecretStore;

    #[test]
    fn set_get_delete_roundtrip() {
        let store = FakeSecretStore::default();
        assert_eq!(store.get("k").unwrap(), None);
        store.set("k", "secret").unwrap();
        assert_eq!(store.get("k").unwrap(), Some("secret".to_string()));
        store.delete("k").unwrap();
        assert_eq!(store.get("k").unwrap(), None);
    }
}
